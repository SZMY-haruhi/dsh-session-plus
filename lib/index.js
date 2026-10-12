import { readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
//#region src/host/session-files.ts
const CANONICAL_LOG_NAME = /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/;
/**
* A committed JSONL generation filename.
* v0 keeps `session.jsonl[.zstd]`; v1 and later use `session.vN.jsonl[.zstd]`,
* including the v3 files introduced in DSH 0.1.5 and the current v4 files.
*/
function isCanonicalSessionLog(filename) {
	return CANONICAL_LOG_NAME.test(filename);
}
/**
* Accept both the current `list()` snapshot (`header` + `revision` +
* optional `sizeBytes` / `eventCount`) and a pre-0.1.5 raw header.
*/
function unwrapListedHeader(item) {
	if (item === null || typeof item !== "object") return void 0;
	const record = item;
	const nested = record.header;
	if (nested !== null && typeof nested === "object") {
		const header = headerFromRecord(nested);
		if (header) return header;
	}
	return headerFromRecord(record);
}
function indexHeaders(entries) {
	const byId = /* @__PURE__ */ new Map();
	for (const entry of entries) {
		const header = unwrapListedHeader(entry);
		if (header) byId.set(header.id, header);
	}
	return byId;
}
/**
* Subagent sessions to remove with `rootId`, deepest child first.
* A fork records `parentSession` too, but it is an ordinary conversation
* (`origin` is unset), so it is left on disk.
*/
function subagentDescendants(headers, rootId) {
	const byParent = /* @__PURE__ */ new Map();
	for (const header of headers) {
		if (header.origin !== "subagent") continue;
		if (!header.parentSession || header.parentSession === header.id) continue;
		const children = byParent.get(header.parentSession);
		if (children) children.push(header.id);
		else byParent.set(header.parentSession, [header.id]);
	}
	const ordered = [];
	const seen = /* @__PURE__ */ new Set([rootId]);
	const walk = (id) => {
		if (seen.has(id)) return;
		seen.add(id);
		for (const child of byParent.get(id) ?? []) walk(child);
		ordered.push(id);
	};
	for (const child of byParent.get(rootId) ?? []) walk(child);
	return ordered;
}
/**
* Session ids are untrusted path segments. Match the JSONL backend's
* injective encoding: safe ASCII stays literal, everything else (including
* `~`) becomes `~XXXX`, and `.` / `..` cannot traverse.
*/
function encodeSegment(raw) {
	if (raw.length === 0) throw new Error("cannot encode an empty path segment");
	if (raw === ".") return "~002E";
	if (raw === "..") return "~002E~002E";
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
		else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
	}
	return out;
}
/** Human-readable project directory key used under the persistence root. */
function projectKey(cwd) {
	if (cwd.length === 0) throw new Error("cannot encode an empty project path");
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}
function sessionDirectory(root, cwd, id) {
	const project = cwd === void 0 ? join(root, "_no-cwd") : join(root, projectKey(cwd));
	return join(project, encodeSegment(id));
}
function isInsideRoot(root, target) {
	const rel = relative(resolve(root), resolve(target));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
/**
* Absolute session directory for one header. The last segment is the encoded
* id, and the directory stays inside `root`.
*/
function resolveOwnedSessionDir(root, header) {
	const dir = resolve(sessionDirectory(resolve(root), header.cwd, header.id));
	if (!isInsideRoot(root, dir)) throw new Error("session path escaped the persistence root");
	return dir;
}
function headerFromRecord(record) {
	if (typeof record.id !== "string") return void 0;
	const id = record.id.trim();
	if (id.length === 0) return void 0;
	const header = { id };
	if (typeof record.cwd === "string" && record.cwd.length > 0) header.cwd = record.cwd;
	if (typeof record.parentSession === "string" && record.parentSession.length > 0) header.parentSession = record.parentSession;
	if (typeof record.origin === "string" && record.origin.length > 0) header.origin = record.origin;
	if (typeof record.isSeeded === "boolean") header.isSeeded = record.isSeeded;
	return header;
}
//#endregion
//#region src/host/index.ts
const name = "dsh-session-plus";
/** Cordis inject list: never read these off ctx without declaring them. */
const inject = [
	"workspaceRegistry",
	"sessionPersistence",
	"webServer",
	"sessions",
	"agents"
];
function sendJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("content-length", Buffer.byteLength(payload));
	res.end(payload);
}
async function readJsonBody(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buf.length;
		if (size > 65536) throw new Error("body too large");
		chunks.push(buf);
	}
	const raw = Buffer.concat(chunks).toString("utf8").trim();
	if (!raw) return {};
	const parsed = JSON.parse(raw);
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid JSON body");
	return parsed;
}
function asSessionId(value) {
	if (typeof value !== "string") return void 0;
	const id = value.trim();
	return id.length > 0 ? id : void 0;
}
function pathnameOf(req) {
	return new URL(req.url ?? "/", "http://session-plus.local").pathname.replace(/\/+$/, "") || "/";
}
function namedError(name, message) {
	const error = new Error(message);
	error.name = name;
	return error;
}
function errorName(error) {
	return error instanceof Error ? error.name : "";
}
async function unarchiveSession(ctx, sessionId) {
	if (typeof ctx.workspaceRegistry.unarchiveSession === "function") {
		await ctx.workspaceRegistry.unarchiveSession(sessionId);
		return;
	}
	const registry = ctx.workspaceRegistry;
	await registry.enqueueOperation(async () => {
		const state = registry.requireState();
		await registry.setState({
			...state,
			archivedSessionIds: state.archivedSessionIds.map(String).filter((id) => id !== sessionId)
		});
	});
}
function persistenceRoot(ctx) {
	const service = ctx.sessionPersistence;
	const raw = service.config?.root ?? service.root;
	if (typeof raw !== "string" || raw.trim().length === 0) return void 0;
	return resolve(raw);
}
async function directoryHasLog(dir) {
	try {
		return (await readdir(dir)).some(isCanonicalSessionLog);
	} catch {
		return false;
	}
}
async function listedHeaders(ctx) {
	return indexHeaders(await ctx.sessionPersistence.list());
}
async function findHeader(ctx, sessionId, headers) {
	return (headers ?? await listedHeaders(ctx)).get(sessionId) ?? ctx.sessions.get(sessionId)?.header;
}
async function locateLegacyDir(ctx, header) {
	const locate = ctx.sessionPersistence.locate;
	if (typeof locate !== "function") return void 0;
	const location = locate.call(ctx.sessionPersistence, header);
	if (!location?.path) return void 0;
	const dir = resolve(dirname(location.path));
	const root = persistenceRoot(ctx);
	if (root && !isInsideRoot(root, dir)) return void 0;
	return dir;
}
/**
* Session directory for a header. The JSONL layout is
* `<root>/<project>/<encoded id>/session.vN.jsonl[.zstd]`. `locate()` is only
* a fallback for hosts that still expose it.
*/
async function findSessionDir(ctx, header) {
	const root = persistenceRoot(ctx);
	if (root) {
		let expected;
		try {
			expected = resolveOwnedSessionDir(root, header);
		} catch {
			expected = void 0;
		}
		if (expected && await directoryHasLog(expected)) return expected;
		const encoded = encodeSegment(header.id);
		const matches = [];
		let projects = [];
		try {
			projects = await readdir(root, { withFileTypes: true });
		} catch {
			projects = [];
		}
		for (const entry of projects) {
			if (!entry.isDirectory()) continue;
			const candidate = resolve(root, entry.name, encoded);
			if (!isInsideRoot(root, candidate)) continue;
			if (await directoryHasLog(candidate)) matches.push(candidate);
		}
		if (matches.length > 1) throw namedError("SessionPlusAmbiguousArtifact", "session id matches more than one persistence directory");
		if (matches.length === 1) return matches[0];
	}
	const legacy = await locateLegacyDir(ctx, header);
	if (legacy && await directoryHasLog(legacy)) return legacy;
}
async function disposeLiveAgent(ctx, sessionId) {
	const agent = ctx.agents.get(sessionId);
	if (!agent) return;
	if (agent.status === "running") {
		agent.cancel({ kind: "disposed" });
		await agent.whenIdle();
	}
	const result = agent.ctx.fiber?.dispose?.();
	if (result && typeof result.then === "function") await result;
}
async function hideFromGrouping(ctx, sessionId) {
	if (ctx.workspaceRegistry.archivedSessionIds.map(String).includes(sessionId)) return;
	try {
		await ctx.workspaceRegistry.archiveSession(sessionId);
	} catch (error) {
		if (errorName(error) === "WorkspaceUnknownSessionError") return;
		throw error;
	}
}
async function deleteArtifact(ctx, sessionId, headers) {
	const header = await findHeader(ctx, sessionId, headers);
	if (!header) return;
	const dir = await findSessionDir(ctx, header);
	if (!dir) {
		if (!persistenceRoot(ctx) && typeof ctx.sessionPersistence.locate !== "function") throw namedError("SessionPlusNoArtifact", "session persistence does not expose a per-session file");
		return;
	}
	await rm(dir, {
		recursive: true,
		force: true
	});
}
function stillStored(ctx, sessionId, byId) {
	return byId.has(sessionId) || Boolean(ctx.sessions.get(sessionId));
}
async function logStillOnDisk(ctx, sessionId, byId) {
	const header = byId.get(sessionId) ?? ctx.sessions.get(sessionId)?.header;
	if (!header) return false;
	if (await findSessionDir(ctx, header)) return true;
	if (!persistenceRoot(ctx) && typeof ctx.sessionPersistence.locate !== "function") return Boolean(ctx.sessions.get(sessionId));
	return false;
}
async function listArchived(ctx) {
	const ids = ctx.workspaceRegistry.archivedSessionIds.map(String);
	const byId = await listedHeaders(ctx);
	const rows = [];
	for (const id of ids) {
		if (!stillStored(ctx, id, byId) || !await logStillOnDisk(ctx, id, byId)) continue;
		const agent = ctx.agents.get(id);
		const header = byId.get(id) ?? ctx.sessions.get(id)?.header;
		rows.push({
			id,
			cwd: header?.cwd,
			live: Boolean(ctx.sessions.get(id) || agent),
			running: agent?.status === "running"
		});
	}
	return rows;
}
async function assertIdle(ctx, sessionId) {
	if (ctx.agents.get(sessionId)?.status === "running") throw namedError("SessionPlusRunning", "session is running; stop it before deleting");
}
async function removeStoredSession(ctx, sessionId, headers) {
	await hideFromGrouping(ctx, sessionId);
	await disposeLiveAgent(ctx, sessionId);
	await deleteArtifact(ctx, sessionId, headers);
}
async function deleteSession(ctx, sessionId) {
	const headers = await listedHeaders(ctx);
	const descendants = subagentDescendants(headers.values(), sessionId);
	await assertIdle(ctx, sessionId);
	for (const childId of descendants) await assertIdle(ctx, childId);
	for (const childId of descendants) await removeStoredSession(ctx, childId, headers);
	await removeStoredSession(ctx, sessionId, headers);
}
function apply(ctx) {
	const host = ctx;
	const logger = host.logger("dsh-session-plus");
	host.effect(() => host.webServer.register({
		kind: "prefix",
		path: "/api/session-plus",
		handler: async (req, res) => {
			const path = pathnameOf(req);
			try {
				if (path === "/api/session-plus/archived" && req.method === "GET") {
					sendJson(res, 200, {
						ok: true,
						sessions: await listArchived(host)
					});
					return;
				}
				if (path === "/api/session-plus/unarchive" && req.method === "POST") {
					const sessionId = asSessionId((await readJsonBody(req)).sessionId);
					if (!sessionId) {
						sendJson(res, 400, {
							ok: false,
							error: "sessionId required"
						});
						return;
					}
					await unarchiveSession(host, sessionId);
					sendJson(res, 200, {
						ok: true,
						sessions: await listArchived(host)
					});
					return;
				}
				if (path === "/api/session-plus/delete" && req.method === "POST") {
					const body = await readJsonBody(req);
					const sessionId = asSessionId(body.sessionId);
					if (!sessionId) {
						sendJson(res, 400, {
							ok: false,
							error: "sessionId required"
						});
						return;
					}
					if (body.confirm !== true) {
						sendJson(res, 400, {
							ok: false,
							error: "confirm required"
						});
						return;
					}
					await deleteSession(host, sessionId);
					sendJson(res, 200, {
						ok: true,
						sessions: await listArchived(host)
					});
					return;
				}
				sendJson(res, 404, {
					ok: false,
					error: "not found"
				});
			} catch (error) {
				const name = errorName(error);
				const message = error instanceof Error ? error.message : String(error);
				logger.warn("dsh-session-plus route failed", error);
				if (name === "SessionPlusRunning" || name === "WorkspaceActiveSessionError") {
					sendJson(res, 409, {
						ok: false,
						error: message,
						code: "running"
					});
					return;
				}
				if (name === "SessionPlusNoArtifact") {
					sendJson(res, 501, {
						ok: false,
						error: message,
						code: "no-artifact"
					});
					return;
				}
				sendJson(res, 500, {
					ok: false,
					error: message
				});
			}
		}
	}), "dsh-session-plus.http");
	logger.info("dsh-session-plus host ready");
}
//#endregion
export { apply, inject, name };
