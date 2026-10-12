import { isAbsolute, join, relative, resolve } from "node:path";
import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";
//#region src/host/session-files.ts
const CANONICAL_LOG_NAME = /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/;
/**
* Whether this filename marks a directory as a committed session log.
* v0 keeps `session.jsonl[.zstd]`; later generations use `session.vN.jsonl[.zstd]`.
* A match only decides that the directory is a session directory.
* Deletion removes the whole directory, not the matching file by itself.
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
/**
* Lexical containment for a path this process is about to build.
* Deletion does not trust this alone: {@link confirmInsideRoot} compares
* `realpath` of the root and the target, and {@link removeSessionDirectory}
* `lstat`s again so a symlink or junction is refused.
*/
function isInsideRoot(root, target) {
	const rel = relative(resolve(root), resolve(target));
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
/**
* Absolute session directory for one header. The last segment is the encoded
* id. This check is lexical; the delete path realpath-checks the directory
* that is actually on disk.
*/
function resolveOwnedSessionDir(root, header) {
	const dir = resolve(sessionDirectory(resolve(root), header.cwd, header.id));
	if (!isInsideRoot(root, dir)) throw new Error("session path escaped the persistence root");
	return dir;
}
/** Ids removed with `rootId`, subagents deepest-first, then the root itself. */
function deletionIds(headers, rootId) {
	return [...subagentDescendants(headers, rootId), rootId];
}
/**
* Refuse the whole delete when any planned id is still live in `ctx.sessions`.
* An open session still owns a persistence handle; removing the directory
* under that handle lets a later flush recreate an incomplete one.
*/
function assertSessionsReleased(ids, isLive) {
	const live = ids.find((id) => isLive(id));
	if (!live) return;
	const error = /* @__PURE__ */ new Error(`session ${live} is open in this process; close it before deleting`);
	error.name = "SessionPlusOpen";
	throw error;
}
/** True when both paths exist and the target's real path stays inside the root's. */
async function confirmInsideRoot(root, target) {
	try {
		return isInsideRoot(await realpath(root), await realpath(target));
	} catch {
		return false;
	}
}
function plaintextLog(filename, bytes) {
	if (!filename.endsWith(".zstd")) return bytes.toString("utf8");
	return zstdDecompressSync(bytes).toString("utf8");
}
/** Session id stored in one directory's committed log, if the header can be read. */
async function readStoredSessionId(dir) {
	let names;
	try {
		names = await readdir(dir);
	} catch {
		return;
	}
	for (const name of names) {
		if (!isCanonicalSessionLog(name)) continue;
		try {
			const line = plaintextLog(name, await readFile(join(dir, name))).split("\n", 1)[0]?.trim();
			if (!line) continue;
			const parsed = JSON.parse(line);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
			const id = parsed.id;
			if (typeof id === "string" && id.length > 0) return id;
		} catch {
			continue;
		}
	}
}
async function directoryOwnedBy(dir, id) {
	try {
		const info = await lstat(dir);
		if (info.isSymbolicLink() || !info.isDirectory()) return false;
	} catch {
		return false;
	}
	return await readStoredSessionId(dir) === id;
}
/**
* Session directory whose on-disk header id is `header.id`.
* The expected project path is preferred. Other project directories are
* accepted only after the log header is read back and the id matches.
* Symlinks are not session directories.
*/
async function findSessionDirectory(root, header) {
	let rootReal;
	try {
		rootReal = await realpath(root);
	} catch {
		return;
	}
	let expected;
	try {
		expected = resolveOwnedSessionDir(rootReal, header);
	} catch {
		expected = void 0;
	}
	if (expected && await directoryOwnedBy(expected, header.id) && await confirmInsideRoot(rootReal, expected)) return expected;
	const encoded = encodeSegment(header.id);
	let projects;
	try {
		projects = await readdir(rootReal, { withFileTypes: true });
	} catch {
		return;
	}
	const matches = [];
	for (const entry of projects) {
		if (!entry.isDirectory()) continue;
		const candidate = resolve(rootReal, entry.name, encoded);
		if (candidate === expected) continue;
		if (!isInsideRoot(rootReal, candidate)) continue;
		if (!await directoryOwnedBy(candidate, header.id)) continue;
		if (!await confirmInsideRoot(rootReal, candidate)) continue;
		matches.push(candidate);
	}
	if (matches.length > 1) {
		const error = /* @__PURE__ */ new Error("session id matches more than one persistence directory");
		error.name = "SessionPlusAmbiguousArtifact";
		throw error;
	}
	return matches[0];
}
/**
* Remove one session directory that is a real directory inside `root`.
* `lstat` runs again immediately before `rm` so a symlink swapped in
* between the earlier check and the delete is not followed.
*/
async function removeSessionDirectory(root, dir) {
	const refuse = (message) => {
		const error = new Error(message);
		error.name = "SessionPlusUnsafePath";
		throw error;
	};
	const inspect = async () => {
		const info = await lstat(dir);
		if (info.isSymbolicLink()) refuse("session directory is a symlink");
		if (!info.isDirectory()) refuse("session path is not a directory");
		if (!await confirmInsideRoot(root, dir)) refuse("session path escaped the persistence root");
	};
	await inspect();
	await inspect();
	await rm(dir, {
		recursive: true,
		force: false
	});
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
function requestUrl(req) {
	return new URL(req.url ?? "/", "http://session-plus.local");
}
function pathnameOf(req) {
	return requestUrl(req).pathname.replace(/\/+$/, "") || "/";
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
async function listedHeaders(ctx) {
	return indexHeaders(await ctx.sessionPersistence.list());
}
async function findHeader(ctx, sessionId, headers) {
	return (headers ?? await listedHeaders(ctx)).get(sessionId) ?? ctx.sessions.get(sessionId)?.header;
}
function stillStored(ctx, sessionId, byId) {
	return byId.has(sessionId) || Boolean(ctx.sessions.get(sessionId));
}
async function logStillOnDisk(ctx, sessionId, byId) {
	const header = byId.get(sessionId) ?? ctx.sessions.get(sessionId)?.header;
	if (!header) return false;
	const root = persistenceRoot(ctx);
	if (!root) return Boolean(ctx.sessions.get(sessionId));
	try {
		return Boolean(await findSessionDirectory(root, header));
	} catch (error) {
		if (errorName(error) === "SessionPlusAmbiguousArtifact") return true;
		throw error;
	}
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
async function hideFromGrouping(ctx, sessionId) {
	if (ctx.workspaceRegistry.archivedSessionIds.map(String).includes(sessionId)) return;
	try {
		await ctx.workspaceRegistry.archiveSession(sessionId);
	} catch (error) {
		if (errorName(error) === "WorkspaceUnknownSessionError") return;
		throw error;
	}
}
/**
* Subagent descendants, deepest first, then the root.
* Logged before any archive or rm. A live id in `ctx.sessions` refuses the
* whole plan: disposing the agent does not close that persistence handle.
*/
async function deleteSession(ctx, sessionId, logger) {
	const headers = await listedHeaders(ctx);
	const ids = deletionIds(headers.values(), sessionId);
	logger.info(`dsh-session-plus delete plan: ${ids.join(" ")}`);
	for (const id of ids) await assertIdle(ctx, id);
	assertSessionsReleased(ids, (id) => ctx.sessions.get(id) !== void 0);
	const root = persistenceRoot(ctx);
	if (!root) throw namedError("SessionPlusNoArtifact", "session persistence does not expose a per-session file");
	const planned = [];
	for (const id of ids) {
		const header = await findHeader(ctx, id, headers);
		const dir = header ? await findSessionDirectory(root, header) : void 0;
		planned.push({
			id,
			dir
		});
	}
	for (const item of planned) {
		await hideFromGrouping(ctx, item.id);
		if (!item.dir) continue;
		await removeSessionDirectory(root, item.dir);
	}
}
async function previewDelete(ctx, sessionId) {
	const descendantIds = subagentDescendants((await listedHeaders(ctx)).values(), sessionId);
	return {
		sessionId,
		descendantCount: descendantIds.length,
		descendantIds
	};
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
				if (path === "/api/session-plus/delete-preview" && req.method === "GET") {
					const sessionId = asSessionId(requestUrl(req).searchParams.get("sessionId"));
					if (!sessionId) {
						sendJson(res, 400, {
							ok: false,
							error: "sessionId required"
						});
						return;
					}
					sendJson(res, 200, {
						ok: true,
						...await previewDelete(host, sessionId)
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
					await deleteSession(host, sessionId, logger);
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
				if (name === "SessionPlusOpen") {
					sendJson(res, 409, {
						ok: false,
						error: message,
						code: "open"
					});
					return;
				}
				if (name === "SessionPlusUnsafePath") {
					sendJson(res, 409, {
						ok: false,
						error: message,
						code: "unsafe"
					});
					return;
				}
				if (name === "SessionPlusAmbiguousArtifact") {
					sendJson(res, 409, {
						ok: false,
						error: message,
						code: "ambiguous"
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
