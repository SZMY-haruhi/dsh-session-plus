import { resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  assertSessionsReleased,
  deletionIds,
  findSessionDirectory,
  indexHeaders,
  removeSessionDirectory,
  subagentDescendants,
  type SessionHeaderLike,
} from './session-files.ts'

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
  cancel(cause: { kind: 'disposed' }): void
  whenIdle(): Promise<void>
}

type PersistenceService = {
  list(options?: { signal?: AbortSignal } | AbortSignal): Promise<readonly unknown[]>
  config?: { root?: unknown }
  root?: unknown
}

type HostLogger = {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
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

function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://session-plus.local')
}

function pathnameOf(req: IncomingMessage): string {
  return requestUrl(req).pathname.replace(/\/+$/, '') || '/'
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

function stillStored(ctx: HostContext, sessionId: string, byId: Map<string, SessionHeaderLike>) {
  return byId.has(sessionId) || Boolean(ctx.sessions.get(sessionId))
}

async function logStillOnDisk(ctx: HostContext, sessionId: string, byId: Map<string, SessionHeaderLike>) {
  const header = byId.get(sessionId) ?? ctx.sessions.get(sessionId)?.header
  if (!header) return false
  const root = persistenceRoot(ctx)
  if (!root) return Boolean(ctx.sessions.get(sessionId))
  try {
    return Boolean(await findSessionDirectory(root, header))
  } catch (error) {
    if (errorName(error) === 'SessionPlusAmbiguousArtifact') return true
    throw error
  }
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

async function hideFromGrouping(ctx: HostContext, sessionId: string) {
  if (ctx.workspaceRegistry.archivedSessionIds.map(String).includes(sessionId)) return
  try {
    await ctx.workspaceRegistry.archiveSession(sessionId)
  } catch (error) {
    if (errorName(error) === 'WorkspaceUnknownSessionError') return
    throw error
  }
}

/**
 * Subagent descendants, deepest first, then the root.
 * Logged before any archive or rm. A live id in `ctx.sessions` refuses the
 * whole plan: disposing the agent does not close that persistence handle.
 */
async function deleteSession(ctx: HostContext, sessionId: string, logger: HostLogger) {
  const headers = await listedHeaders(ctx)
  const ids = deletionIds(headers.values(), sessionId)
  logger.info(`dsh-session-plus delete plan: ${ids.join(' ')}`)
  for (const id of ids) await assertIdle(ctx, id)
  assertSessionsReleased(ids, (id) => ctx.sessions.get(id) !== undefined)
  const root = persistenceRoot(ctx)
  if (!root) {
    throw namedError('SessionPlusNoArtifact', 'session persistence does not expose a per-session file')
  }
  const planned: { id: string; dir?: string }[] = []
  for (const id of ids) {
    const header = await findHeader(ctx, id, headers)
    const dir = header ? await findSessionDirectory(root, header) : undefined
    planned.push({ id, dir })
  }
  for (const item of planned) {
    await hideFromGrouping(ctx, item.id)
    if (!item.dir) continue
    await removeSessionDirectory(root, item.dir)
  }
}

async function previewDelete(ctx: HostContext, sessionId: string) {
  const headers = await listedHeaders(ctx)
  const descendantIds = subagentDescendants(headers.values(), sessionId)
  return { sessionId, descendantCount: descendantIds.length, descendantIds }
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
            if (path === '/api/session-plus/delete-preview' && req.method === 'GET') {
              const sessionId = asSessionId(requestUrl(req).searchParams.get('sessionId'))
              if (!sessionId) {
                sendJson(res, 400, { ok: false, error: 'sessionId required' })
                return
              }
              sendJson(res, 200, { ok: true, ...(await previewDelete(host, sessionId)) })
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
              await deleteSession(host, sessionId, logger)
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
            if (name === 'SessionPlusOpen') {
              sendJson(res, 409, { ok: false, error: message, code: 'open' })
              return
            }
            if (name === 'SessionPlusUnsafePath') {
              sendJson(res, 409, { ok: false, error: message, code: 'unsafe' })
              return
            }
            if (name === 'SessionPlusAmbiguousArtifact') {
              sendJson(res, 409, { ok: false, error: message, code: 'ambiguous' })
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
