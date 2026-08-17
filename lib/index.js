import { access, rm, rmdir } from "node:fs/promises";
import { dirname, join } from "node:path";
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
async function writeArchived(ctx, archivedSessionIds) {
	const registry = ctx.workspaceRegistry;
	await registry.enqueueOperation(async () => {
		const state = registry.requireState();
		await registry.setState({
			...state,
			archivedSessionIds
		});
	});
}
async function unarchiveSession(ctx, sessionId) {
	const current = ctx.workspaceRegistry.archivedSessionIds.map(String);
	const next = current.filter((id) => id !== sessionId);
	if (next.length === current.length) return;
	await writeArchived(ctx, next);
}
async function findHeader(ctx, sessionId) {
	const live = ctx.sessions.get(sessionId);
	if (live?.header) return live.header;
	return (await ctx.sessionPersistence.list()).find((header) => String(header.id) === sessionId);
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
	await ctx.workspaceRegistry.archiveSession(sessionId);
}
async function deleteArtifact(ctx, sessionId) {
	const header = await findHeader(ctx, sessionId);
	if (!header) return;
	const location = ctx.sessionPersistence.locate(header);
	if (!location) {
		const error = /* @__PURE__ */ new Error("session persistence does not expose a per-session file");
		error.name = "SessionPlusNoArtifact";
		throw error;
	}
	const dir = dirname(location.path);
	await rm(location.path, { force: true });
	await rm(join(dir, "session.jsonl"), { force: true });
	await rm(join(dir, "session.jsonl.zstd"), { force: true });
	try {
		await rmdir(dir);
	} catch {}
}
function stillStored(ctx, sessionId, byId) {
	return byId.has(sessionId) || Boolean(ctx.sessions.get(sessionId));
}
async function logStillOnDisk(ctx, sessionId, byId) {
	const header = byId.get(sessionId) ?? ctx.sessions.get(sessionId)?.header;
	if (!header) return false;
	const location = ctx.sessionPersistence.locate(header);
	if (!location) return Boolean(ctx.sessions.get(sessionId));
	const dir = dirname(location.path);
	for (const file of [
		location.path,
		join(dir, "session.jsonl"),
		join(dir, "session.jsonl.zstd")
	]) try {
		await access(file);
		return true;
	} catch {}
	return false;
}
async function listArchived(ctx) {
	const ids = ctx.workspaceRegistry.archivedSessionIds.map(String);
	const headers = await ctx.sessionPersistence.list();
	const byId = new Map(headers.map((header) => [String(header.id), header]));
	const rows = [];
	for (const id of ids) {
		if (!stillStored(ctx, id, byId) || !await logStillOnDisk(ctx, id, byId)) continue;
		const agent = ctx.agents.get(id);
		rows.push({
			id,
			cwd: byId.get(id)?.cwd ?? ctx.sessions.get(id)?.header.cwd,
			live: Boolean(ctx.sessions.get(id) || agent),
			running: agent?.status === "running"
		});
	}
	return rows;
}
async function deleteSession(ctx, sessionId) {
	if (ctx.agents.get(sessionId)?.status === "running") {
		const error = /* @__PURE__ */ new Error("session is running; stop it before deleting");
		error.name = "SessionPlusRunning";
		throw error;
	}
	await hideFromGrouping(ctx, sessionId);
	await disposeLiveAgent(ctx, sessionId);
	await deleteArtifact(ctx, sessionId);
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
				const name = error instanceof Error ? error.name : "";
				const message = error instanceof Error ? error.message : String(error);
				logger.warn("dsh-session-plus route failed", error);
				if (name === "SessionPlusRunning") {
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
