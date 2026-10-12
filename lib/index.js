import { isAbsolute, join, relative, resolve } from "node:path";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
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
const HEADER_LINE_LIMIT = 1048576;
/**
* `zstdDecompressSync` arrived in Node 22.15. On 22.6–22.14 the export is
* missing; treating that as an unreadable header would archive the session
* and still report success.
*/
function requireZstdDecompress(decompress = zstdDecompressSync) {
	if (typeof decompress !== "function") {
		const error = /* @__PURE__ */ new Error("node:zlib zstdDecompressSync requires Node.js >= 22.15");
		error.name = "SessionPlusZstdUnavailable";
		throw error;
	}
	return decompress;
}
async function readFirstPlainLine(file) {
	const handle = await open(file, "r");
	try {
		const chunks = [];
		let read = 0;
		const buf = Buffer.alloc(4096);
		while (read < HEADER_LINE_LIMIT) {
			const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, HEADER_LINE_LIMIT - read), read);
			if (bytesRead === 0) break;
			const slice = buf.subarray(0, bytesRead);
			const newline = slice.indexOf(10);
			if (newline !== -1) {
				chunks.push(slice.subarray(0, newline));
				return Buffer.concat(chunks).toString("utf8").trim();
			}
			chunks.push(Buffer.from(slice));
			read += bytesRead;
		}
		const text = Buffer.concat(chunks).toString("utf8").trim();
		return text.length > 0 ? text : void 0;
	} finally {
		await handle.close();
	}
}
/** Decompress only until the first header line is complete. Later frames stay unread. */
async function readFirstZstdLine(file) {
	const decompress = requireZstdDecompress();
	const handle = await open(file, "r");
	try {
		const chunks = [];
		let read = 0;
		const buf = Buffer.alloc(8192);
		while (read < HEADER_LINE_LIMIT) {
			const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, HEADER_LINE_LIMIT - read), read);
			if (bytesRead === 0) break;
			chunks.push(Buffer.from(buf.subarray(0, bytesRead)));
			read += bytesRead;
			let text;
			try {
				text = decompress(Buffer.concat(chunks)).toString("utf8");
			} catch {
				continue;
			}
			const newline = text.indexOf("\n");
			if (newline === -1) continue;
			const line = text.slice(0, newline).trim();
			if (line.length === 0) continue;
			try {
				JSON.parse(line);
			} catch {
				continue;
			}
			return line;
		}
		return;
	} finally {
		await handle.close();
	}
}
/** Session id stored in one directory's committed log, if the header line can be read. */
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
			const line = name.endsWith(".zstd") ? await readFirstZstdLine(join(dir, name)) : await readFirstPlainLine(join(dir, name));
			if (!line) continue;
			const parsed = JSON.parse(line);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
			const id = parsed.id;
			if (typeof id === "string" && id.length > 0) return id;
		} catch (error) {
			if (error instanceof Error && error.name === "SessionPlusZstdUnavailable") throw error;
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
	"connection",
	"sessions",
	"agents"
];
function jsonResponse(status, body) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" }
	});
}
async function readJsonBody(request) {
	const raw = (await request.text()).trim();
	if (raw.length > 65536) throw new Error("body too large");
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
function errorDetails(error) {
	if (!(error instanceof Error)) return void 0;
	const details = error.details;
	return details && typeof details === "object" ? details : void 0;
}
function namedError(name, message, details) {
	const error = new Error(message);
	error.name = name;
	if (details) error.details = details;
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
/**
* Durable titles live in `session/title` events, not in the log header.
* The archive panel reads `ctx.sessions.list` first (`title`, then
* `displayTitle`). This field is the same log-backed title from
* `sessionQuery.readTitle`, for a row whose client projection has not arrived.
*/
async function durableTitle(ctx, sessionId) {
	const query = ctx.get("sessionQuery");
	if (typeof query?.readTitle !== "function") return void 0;
	try {
		const snapshot = await query.readTitle(sessionId);
		if (snapshot === null || typeof snapshot !== "object") return void 0;
		const title = snapshot.title;
		return typeof title === "string" && title.trim().length > 0 ? title : void 0;
	} catch {
		return;
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
		const title = await durableTitle(ctx, id);
		rows.push({
			id,
			cwd: header?.cwd,
			...title ? { title } : {},
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
function sameIds(left, right) {
	return left.length === right.length && left.every((id, index) => id === right[index]);
}
function asIdList(value) {
	if (!Array.isArray(value)) return void 0;
	const ids = [];
	for (const item of value) {
		const id = asSessionId(item);
		if (!id) return void 0;
		ids.push(id);
	}
	return ids;
}
async function deleteSession(ctx, sessionId, descendantIds, logger) {
	const headers = await listedHeaders(ctx);
	const descendants = subagentDescendants(headers.values(), sessionId);
	if (!sameIds(descendants, descendantIds)) throw namedError("SessionPlusPreviewStale", "descendant sessions changed; refresh the confirmation and try again", { descendantIds: descendants });
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
	const missing = planned.filter((item) => !item.dir).map((item) => item.id);
	if (missing.length > 0) throw namedError("SessionPlusNotFound", `session directory not found: ${missing.join(" ")}`, { missing });
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
async function respond(logger, run) {
	try {
		return await run();
	} catch (error) {
		const name = errorName(error);
		const message = error instanceof Error ? error.message : String(error);
		const details = errorDetails(error);
		logger.warn("dsh-session-plus route failed", error);
		if (name === "SessionPlusRunning" || name === "WorkspaceActiveSessionError") return jsonResponse(409, {
			ok: false,
			error: message,
			code: "running"
		});
		if (name === "SessionPlusOpen") return jsonResponse(409, {
			ok: false,
			error: message,
			code: "open"
		});
		if (name === "SessionPlusPreviewStale") return jsonResponse(409, {
			ok: false,
			error: message,
			code: "stale",
			...details
		});
		if (name === "SessionPlusUnsafePath") return jsonResponse(409, {
			ok: false,
			error: message,
			code: "unsafe"
		});
		if (name === "SessionPlusAmbiguousArtifact") return jsonResponse(409, {
			ok: false,
			error: message,
			code: "ambiguous"
		});
		if (name === "SessionPlusNotFound") return jsonResponse(404, {
			ok: false,
			error: message,
			code: "not-found",
			...details
		});
		if (name === "SessionPlusNoArtifact") return jsonResponse(501, {
			ok: false,
			error: message,
			code: "no-artifact"
		});
		if (name === "SessionPlusZstdUnavailable") return jsonResponse(500, {
			ok: false,
			error: message,
			code: "zstd"
		});
		return jsonResponse(500, {
			ok: false,
			error: message
		});
	}
}
/**
* Exact Fetch routes on `ctx.connection`. The `/api` prefix admits the
* request (Host/Origin, then 401) before these handlers run. A longer
* `webServer` prefix would skip that admission.
*/
function apply(ctx) {
	const host = ctx;
	const logger = host.logger("dsh-session-plus");
	const routes = [
		{
			path: "/api/session-plus/archived",
			methods: ["GET"],
			requestBody: "buffered",
			fetch: () => respond(logger, async () => jsonResponse(200, {
				ok: true,
				sessions: await listArchived(host)
			}))
		},
		{
			path: "/api/session-plus/delete-preview",
			methods: ["GET"],
			requestBody: "buffered",
			fetch: (request) => respond(logger, async () => {
				const sessionId = asSessionId(new URL(request.url).searchParams.get("sessionId"));
				if (!sessionId) return jsonResponse(400, {
					ok: false,
					error: "sessionId required"
				});
				return jsonResponse(200, {
					ok: true,
					...await previewDelete(host, sessionId)
				});
			})
		},
		{
			path: "/api/session-plus/unarchive",
			methods: ["POST"],
			requestBody: "buffered",
			fetch: (request) => respond(logger, async () => {
				const sessionId = asSessionId((await readJsonBody(request)).sessionId);
				if (!sessionId) return jsonResponse(400, {
					ok: false,
					error: "sessionId required"
				});
				await unarchiveSession(host, sessionId);
				return jsonResponse(200, {
					ok: true,
					sessions: await listArchived(host)
				});
			})
		},
		{
			path: "/api/session-plus/delete",
			methods: ["POST"],
			requestBody: "buffered",
			fetch: (request) => respond(logger, async () => {
				const body = await readJsonBody(request);
				const sessionId = asSessionId(body.sessionId);
				if (!sessionId) return jsonResponse(400, {
					ok: false,
					error: "sessionId required"
				});
				if (body.confirm !== true) return jsonResponse(400, {
					ok: false,
					error: "confirm required"
				});
				const descendantIds = asIdList(body.descendantIds);
				if (!descendantIds) return jsonResponse(400, {
					ok: false,
					error: "descendantIds required"
				});
				await deleteSession(host, sessionId, descendantIds, logger);
				return jsonResponse(200, {
					ok: true,
					sessions: await listArchived(host)
				});
			})
		}
	];
	host.effect(() => {
		const stops = routes.map((route) => host.connection.fetch.register(route));
		return async () => {
			for (const stop of stops) await stop();
		};
	}, "dsh-session-plus.http");
	logger.info("dsh-session-plus host ready");
}
//#endregion
export { apply, inject, name };
