import { resolve } from 'node:path'
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
  'connection',
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

type FetchMethod = 'GET' | 'HEAD' | 'POST'

type ConnectionFetchRoute = {
  path: string
  methods: readonly FetchMethod[]
  requestBody: 'buffered' | 'streaming'
  fetch: (request: Request) => Promise<Response>
}

type HostContext = Context & {
  workspaceRegistry: RegistryInternals
  sessionPersistence: PersistenceService
  connection: {
    fetch: {
      register(route: ConnectionFetchRoute): () => Promise<void>
    }
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
  title?: string
  live: boolean
  running: boolean
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const raw = (await request.text()).trim()
  if (raw.length > 64 * 1024) throw new Error('body too large')
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

function errorDetails(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof Error)) return undefined
  const details = (error as Error & { details?: Record<string, unknown> }).details
  return details && typeof details === 'object' ? details : undefined
}

function namedError(name: string, message: string, details?: Record<string, unknown>) {
  const error = new Error(message) as Error & { details?: Record<string, unknown> }
  error.name = name
  if (details) error.details = details
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

type TitleObservationResult =
  | {
      sessionId: string
      status: 'fulfilled'
      value?: { title?: { title?: unknown } }
    }
  | {
      sessionId: string
      status: 'rejected'
    }

/**
 * Durable titles live in `session/title` events, not in the log header.
 * The archive panel reads `ctx.sessions.list` first (`title`, then
 * `displayTitle`). These fields are the same log-backed titles from one
 * `sessionQuery.readTitleSnapshots` call, for rows whose client projection
 * has not arrived. A rejected observation omits that row's title.
 */
async function durableTitles(ctx: HostContext, sessionIds: readonly string[]): Promise<Map<string, string>> {
  const titles = new Map<string, string>()
  if (sessionIds.length === 0) return titles
  const query = ctx.get('sessionQuery') as
    | { readTitleSnapshots?: (ids: readonly string[]) => Promise<readonly TitleObservationResult[]> }
    | undefined
  if (typeof query?.readTitleSnapshots !== 'function') return titles
  let results: readonly TitleObservationResult[]
  try {
    results = await query.readTitleSnapshots(sessionIds)
  } catch {
    return titles
  }
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const title = result.value?.title?.title
    if (typeof title === 'string' && title.trim().length > 0) titles.set(String(result.sessionId), title)
  }
  return titles
}

async function listArchived(ctx: HostContext): Promise<ArchivedRow[]> {
  const ids = ctx.workspaceRegistry.archivedSessionIds.map(String)
  const byId = await listedHeaders(ctx)
  const pending: ArchivedRow[] = []
  for (const id of ids) {
    if (!stillStored(ctx, id, byId) || !(await logStillOnDisk(ctx, id, byId))) continue
    const agent = ctx.agents.get(id)
    const header = byId.get(id) ?? ctx.sessions.get(id)?.header
    pending.push({
      id,
      cwd: header?.cwd,
      live: Boolean(ctx.sessions.get(id) || agent),
      running: agent?.status === 'running',
    })
  }
  const titles = await durableTitles(ctx, pending.map((row) => row.id))
  return pending.map((row) => {
    const title = titles.get(row.id)
    return title ? { ...row, title } : row
  })
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
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function asIdList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const ids: string[] = []
  for (const item of value) {
    const id = asSessionId(item)
    if (!id) return undefined
    ids.push(id)
  }
  return ids
}

async function deleteSession(
  ctx: HostContext,
  sessionId: string,
  descendantIds: readonly string[],
  logger: HostLogger,
) {
  const headers = await listedHeaders(ctx)
  const descendants = subagentDescendants(headers.values(), sessionId)
  if (!sameIds(descendants, descendantIds)) {
    throw namedError(
      'SessionPlusPreviewStale',
      'descendant sessions changed; refresh the confirmation and try again',
      { descendantIds: descendants },
    )
  }
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
  const missing = planned.filter((item) => !item.dir).map((item) => item.id)
  if (missing.length > 0) {
    throw namedError('SessionPlusNotFound', `session directory not found: ${missing.join(' ')}`, { missing })
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

async function respond(logger: HostLogger, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    const name = errorName(error)
    const message = error instanceof Error ? error.message : String(error)
    const details = errorDetails(error)
    logger.warn('dsh-session-plus route failed', error)
    if (name === 'SessionPlusRunning' || name === 'WorkspaceActiveSessionError') {
      return jsonResponse(409, { ok: false, error: message, code: 'running' })
    }
    if (name === 'SessionPlusOpen') {
      return jsonResponse(409, { ok: false, error: message, code: 'open' })
    }
    if (name === 'SessionPlusPreviewStale') {
      return jsonResponse(409, { ok: false, error: message, code: 'stale', ...details })
    }
    if (name === 'SessionPlusUnsafePath') {
      return jsonResponse(409, { ok: false, error: message, code: 'unsafe' })
    }
    if (name === 'SessionPlusAmbiguousArtifact') {
      return jsonResponse(409, { ok: false, error: message, code: 'ambiguous' })
    }
    if (name === 'SessionPlusNotFound') {
      return jsonResponse(404, { ok: false, error: message, code: 'not-found', ...details })
    }
    if (name === 'SessionPlusNoArtifact') {
      return jsonResponse(501, { ok: false, error: message, code: 'no-artifact' })
    }
    if (name === 'SessionPlusZstdUnavailable') {
      return jsonResponse(500, { ok: false, error: message, code: 'zstd' })
    }
    return jsonResponse(500, { ok: false, error: message })
  }
}

/**
 * Exact Fetch routes on `ctx.connection`. The `/api` prefix admits the
 * request (Host/Origin, then 401) before these handlers run. A longer
 * `webServer` prefix would skip that admission.
 */
export function apply(ctx: Context) {
  const host = ctx as HostContext
  const logger = host.logger('dsh-session-plus')
  const routes: ConnectionFetchRoute[] = [
    {
      path: '/api/session-plus/archived',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: () => respond(logger, async () => jsonResponse(200, { ok: true, sessions: await listArchived(host) })),
    },
    {
      path: '/api/session-plus/delete-preview',
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: (request) =>
        respond(logger, async () => {
          const sessionId = asSessionId(new URL(request.url).searchParams.get('sessionId'))
          if (!sessionId) return jsonResponse(400, { ok: false, error: 'sessionId required' })
          return jsonResponse(200, { ok: true, ...(await previewDelete(host, sessionId)) })
        }),
    },
    {
      path: '/api/session-plus/unarchive',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) =>
        respond(logger, async () => {
          const sessionId = asSessionId((await readJsonBody(request)).sessionId)
          if (!sessionId) return jsonResponse(400, { ok: false, error: 'sessionId required' })
          await unarchiveSession(host, sessionId)
          return jsonResponse(200, { ok: true, sessions: await listArchived(host) })
        }),
    },
    {
      path: '/api/session-plus/delete',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) =>
        respond(logger, async () => {
          const body = await readJsonBody(request)
          const sessionId = asSessionId(body.sessionId)
          if (!sessionId) return jsonResponse(400, { ok: false, error: 'sessionId required' })
          if (body.confirm !== true) return jsonResponse(400, { ok: false, error: 'confirm required' })
          const descendantIds = asIdList(body.descendantIds)
          if (!descendantIds) return jsonResponse(400, { ok: false, error: 'descendantIds required' })
          await deleteSession(host, sessionId, descendantIds, logger)
          return jsonResponse(200, { ok: true, sessions: await listArchived(host) })
        }),
    },
  ]

  host.effect(() => {
    const stops = routes.map((route) => host.connection.fetch.register(route))
    return async () => {
      for (const stop of stops) await stop()
    }
  }, 'dsh-session-plus.http')

  logger.info('dsh-session-plus host ready')
}
