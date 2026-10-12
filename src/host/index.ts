import { readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  encodeSegment,
  indexHeaders,
  isCanonicalSessionLog,
  isInsideRoot,
  resolveOwnedSessionDir,
  subagentDescendants,
  type SessionHeaderLike,
} from './session-files'

export const name = 'dsh-session-plus'

/** Cordis inject list: never read these off ctx without declaring them. */
export const inject = [
  'workspaceRegistry',
  'sessionPersistence',
  'webServer',
  'sessions',
  'agents',
]

type RegistryState = {
  archivedSessionIds: string[]
  [key: string]: unknown
}

type RegistryInternals = {
  archivedSessionIds: readonly string[]
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
  unarchiveSession(sessionId: string): Promise<void>
  enqueueOperation<T>(operation: () => Promise<T>): Promise<T>
  requireState(): RegistryState
  setState(state: RegistryState): Promise<void>
}

type AgentLike = {
  status: 'idle' | 'running'
  ctx: { fiber?: { dispose?: () => unknown } }
  cancel(cause: { kind: 'disposed' }): void
  whenIdle(): Promise<void>
}

type PersistenceService = {
  list(options?: { signal?: AbortSignal } | AbortSignal): Promise<readonly unknown[]>
  locate?(header: SessionHeaderLike): { path: string } | undefined
  config?: { root?: unknown }
  root?: unknown
}

type HostContext = Context & {
  workspaceRegistry: RegistryInternals
  sessionPersistence: PersistenceService
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
    }): () => void
  }
  sessions: {
    get(id: string): { header: SessionHeaderLike } | undefined
  }
  agents: {
    get(id: string): AgentLike | undefined
  }
}

type ArchivedRow = {
  id: string
  cwd?: string
  live: boolean
  running: boolean
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(payload))
  res.end(payload)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buf.length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(buf)
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  const parsed: unknown = JSON.parse(raw)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid JSON body')
  }
  return parsed as Record<string, unknown>
}

function asSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.trim()
  return id.length > 0 ? id : undefined
}

function pathnameOf(req: IncomingMessage): string {
  const url = new URL(req.url ?? '/', 'http://session-plus.local')
  return url.pathname.replace(/\/+$/, '') || '/'
}

function namedError(name: string, message: string) {
  const error = new Error(message)
  error.name = name
  return error
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : ''
}

async function unarchiveSession(ctx: HostContext, sessionId: string) {
  if (typeof ctx.workspaceRegistry.unarchiveSession === 'function') {
    await ctx.workspaceRegistry.unarchiveSession(sessionId)
    return
  }
  const registry = ctx.workspaceRegistry
  await registry.enqueueOperation(async () => {
    const state = registry.requireState()
    await registry.setState({
      ...state,
      archivedSessionIds: state.archivedSessionIds.map(String).filter((id) => id !== sessionId),
    })
  })
}

function persistenceRoot(ctx: HostContext): string | undefined {
  const service = ctx.sessionPersistence
  const raw = service.config?.root ?? service.root
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  return resolve(raw)
}

async function directoryHasLog(dir: string): Promise<boolean> {
  try {
    const names = await readdir(dir)
    return names.some(isCanonicalSessionLog)
  } catch {
    return false
  }
}

async function listedHeaders(ctx: HostContext): Promise<Map<string, SessionHeaderLike>> {
  const listed = await ctx.sessionPersistence.list()
  return indexHeaders(listed)
}

async function findHeader(
  ctx: HostContext,
  sessionId: string,
  headers?: Map<string, SessionHeaderLike>,
): Promise<SessionHeaderLike | undefined> {
  const stored = headers ?? (await listedHeaders(ctx))
  return stored.get(sessionId) ?? ctx.sessions.get(sessionId)?.header
}

async function locateLegacyDir(ctx: HostContext, header: SessionHeaderLike): Promise<string | undefined> {
  const locate = ctx.sessionPersistence.locate
  if (typeof locate !== 'function') return undefined
  const location = locate.call(ctx.sessionPersistence, header)
  if (!location?.path) return undefined
  const dir = resolve(dirname(location.path))
  const root = persistenceRoot(ctx)
  if (root && !isInsideRoot(root, dir)) return undefined
  return dir
}

/**
 * Session directory for a header. The JSONL layout is
 * `<root>/<project>/<encoded id>/session.vN.jsonl[.zstd]`. `locate()` is only
 * a fallback for hosts that still expose it.
 */
async function findSessionDir(ctx: HostContext, header: SessionHeaderLike): Promise<string | undefined> {
  const root = persistenceRoot(ctx)
  if (root) {
    let expected: string | undefined
    try {
      expected = resolveOwnedSessionDir(root, header)
    } catch {
      expected = undefined
    }
    if (expected && (await directoryHasLog(expected))) return expected
    const encoded = encodeSegment(header.id)
    const matches: string[] = []
    let projects: { name: string; isDirectory: () => boolean }[] = []
    try {
      projects = await readdir(root, { withFileTypes: true })
    } catch {
      projects = []
    }
    for (const entry of projects) {
      if (!entry.isDirectory()) continue
      const candidate = resolve(root, entry.name, encoded)
      if (!isInsideRoot(root, candidate)) continue
      if (await directoryHasLog(candidate)) matches.push(candidate)
    }
    if (matches.length > 1) {
      throw namedError('SessionPlusAmbiguousArtifact', 'session id matches more than one persistence directory')
    }
    if (matches.length === 1) return matches[0]
  }
  const legacy = await locateLegacyDir(ctx, header)
  if (legacy && (await directoryHasLog(legacy))) return legacy
  return undefined
}

async function disposeLiveAgent(ctx: HostContext, sessionId: string) {
  const agent = ctx.agents.get(sessionId)
  if (!agent) return
  if (agent.status === 'running') {
    agent.cancel({ kind: 'disposed' })
    await agent.whenIdle()
  }
  const result = agent.ctx.fiber?.dispose?.()
  if (result && typeof (result as Promise<unknown>).then === 'function') {
    await result
  }
}

async function hideFromGrouping(ctx: HostContext, sessionId: string) {
  if (ctx.workspaceRegistry.archivedSessionIds.map(String).includes(sessionId)) return
  try {
    await ctx.workspaceRegistry.archiveSession(sessionId)
  } catch (error) {
    if (errorName(error) === 'WorkspaceUnknownSessionError') return
    throw error
  }
}

async function deleteArtifact(ctx: HostContext, sessionId: string, headers: Map<string, SessionHeaderLike>) {
  const header = await findHeader(ctx, sessionId, headers)
  if (!header) return
  const dir = await findSessionDir(ctx, header)
  if (!dir) {
    if (!persistenceRoot(ctx) && typeof ctx.sessionPersistence.locate !== 'function') {
      throw namedError('SessionPlusNoArtifact', 'session persistence does not expose a per-session file')
    }
    return
  }
  await rm(dir, { recursive: true, force: true })
}

function stillStored(ctx: HostContext, sessionId: string, byId: Map<string, SessionHeaderLike>) {
  return byId.has(sessionId) || Boolean(ctx.sessions.get(sessionId))
}

async function logStillOnDisk(ctx: HostContext, sessionId: string, byId: Map<string, SessionHeaderLike>) {
  const header = byId.get(sessionId) ?? ctx.sessions.get(sessionId)?.header
  if (!header) return false
  if (await findSessionDir(ctx, header)) return true
  if (!persistenceRoot(ctx) && typeof ctx.sessionPersistence.locate !== 'function') {
    return Boolean(ctx.sessions.get(sessionId))
  }
  return false
}

async function listArchived(ctx: HostContext): Promise<ArchivedRow[]> {
  const ids = ctx.workspaceRegistry.archivedSessionIds.map(String)
  const byId = await listedHeaders(ctx)
  const rows: ArchivedRow[] = []
  for (const id of ids) {
    if (!stillStored(ctx, id, byId) || !(await logStillOnDisk(ctx, id, byId))) continue
    const agent = ctx.agents.get(id)
    const header = byId.get(id) ?? ctx.sessions.get(id)?.header
    rows.push({
      id,
      cwd: header?.cwd,
      live: Boolean(ctx.sessions.get(id) || agent),
      running: agent?.status === 'running',
    })
  }
  return rows
}

async function assertIdle(ctx: HostContext, sessionId: string) {
  if (ctx.agents.get(sessionId)?.status === 'running') {
    throw namedError('SessionPlusRunning', 'session is running; stop it before deleting')
  }
}

async function removeStoredSession(
  ctx: HostContext,
  sessionId: string,
  headers: Map<string, SessionHeaderLike>,
) {
  await hideFromGrouping(ctx, sessionId)
  await disposeLiveAgent(ctx, sessionId)
  await deleteArtifact(ctx, sessionId, headers)
}

async function deleteSession(ctx: HostContext, sessionId: string) {
  const headers = await listedHeaders(ctx)
  const descendants = subagentDescendants(headers.values(), sessionId)
  await assertIdle(ctx, sessionId)
  for (const childId of descendants) await assertIdle(ctx, childId)
  // Children first. A fork that only shares parentSession is not in this list.
  for (const childId of descendants) {
    await removeStoredSession(ctx, childId, headers)
  }
  // Hide first and keep the tombstone in archivedSessionIds. Unarchiving after
  // rm() puts a file-less row back on the conversation list until restart.
  await removeStoredSession(ctx, sessionId, headers)
}

export function apply(ctx: Context) {
  const host = ctx as HostContext
  const logger = host.logger('dsh-session-plus')

  host.effect(
    () =>
      host.webServer.register({
        kind: 'prefix',
        path: '/api/session-plus',
        handler: async (req, res) => {
          const path = pathnameOf(req)
          try {
            if (path === '/api/session-plus/archived' && req.method === 'GET') {
              sendJson(res, 200, { ok: true, sessions: await listArchived(host) })
              return
            }
            if (path === '/api/session-plus/unarchive' && req.method === 'POST') {
              const sessionId = asSessionId((await readJsonBody(req)).sessionId)
              if (!sessionId) {
                sendJson(res, 400, { ok: false, error: 'sessionId required' })
                return
              }
              await unarchiveSession(host, sessionId)
              sendJson(res, 200, { ok: true, sessions: await listArchived(host) })
              return
            }
            if (path === '/api/session-plus/delete' && req.method === 'POST') {
              const body = await readJsonBody(req)
              const sessionId = asSessionId(body.sessionId)
              if (!sessionId) {
                sendJson(res, 400, { ok: false, error: 'sessionId required' })
                return
              }
              if (body.confirm !== true) {
                sendJson(res, 400, { ok: false, error: 'confirm required' })
                return
              }
              await deleteSession(host, sessionId)
              sendJson(res, 200, { ok: true, sessions: await listArchived(host) })
              return
            }
            sendJson(res, 404, { ok: false, error: 'not found' })
          } catch (error) {
            const name = errorName(error)
            const message = error instanceof Error ? error.message : String(error)
            logger.warn('dsh-session-plus route failed', error)
            if (name === 'SessionPlusRunning' || name === 'WorkspaceActiveSessionError') {
              sendJson(res, 409, { ok: false, error: message, code: 'running' })
              return
            }
            if (name === 'SessionPlusNoArtifact') {
              sendJson(res, 501, { ok: false, error: message, code: 'no-artifact' })
              return
            }
            sendJson(res, 500, { ok: false, error: message })
          }
        },
      }),
    'dsh-session-plus.http',
  )

  logger.info('dsh-session-plus host ready')
}
