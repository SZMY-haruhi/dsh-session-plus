import { access, rm, rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-session-plus'

/** Cordis inject list: never read these off ctx without declaring them. */
export const inject = [
  'workspaceRegistry',
  'sessionPersistence',
  'webServer',
  'sessions',
  'agents',
]

type SessionHeaderLike = {
  id: string
  cwd?: string
}

type RegistryState = {
  archivedSessionIds: string[]
  [key: string]: unknown
}

type RegistryInternals = {
  archivedSessionIds: readonly string[]
  archiveSession(sessionId: string): Promise<void>
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

type HostContext = Context & {
  workspaceRegistry: RegistryInternals
  sessionPersistence: {
    list(signal?: AbortSignal): Promise<SessionHeaderLike[]>
    locate(header: SessionHeaderLike): { path: string } | undefined
  }
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

async function writeArchived(ctx: HostContext, archivedSessionIds: string[]) {
  const registry = ctx.workspaceRegistry
  await registry.enqueueOperation(async () => {
    const state = registry.requireState()
    await registry.setState({
      ...state,
      archivedSessionIds,
    })
  })
}

async function unarchiveSession(ctx: HostContext, sessionId: string) {
  const current = ctx.workspaceRegistry.archivedSessionIds.map(String)
  const next = current.filter((id) => id !== sessionId)
  if (next.length === current.length) return
  await writeArchived(ctx, next)
}

async function findHeader(ctx: HostContext, sessionId: string): Promise<SessionHeaderLike | undefined> {
  const live = ctx.sessions.get(sessionId)
  if (live?.header) return live.header
  const headers = await ctx.sessionPersistence.list()
  return headers.find((header) => String(header.id) === sessionId)
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
  await ctx.workspaceRegistry.archiveSession(sessionId)
}

async function deleteArtifact(ctx: HostContext, sessionId: string) {
  const header = await findHeader(ctx, sessionId)
  if (!header) return
  const location = ctx.sessionPersistence.locate(header)
  if (!location) {
    const error = new Error('session persistence does not expose a per-session file')
    error.name = 'SessionPlusNoArtifact'
    throw error
  }
  const dir = dirname(location.path)
  await rm(location.path, { force: true })
  await rm(join(dir, 'session.jsonl'), { force: true })
  await rm(join(dir, 'session.jsonl.zstd'), { force: true })
  try {
    await rmdir(dir)
  } catch {
    // Session dir may still hold unrelated sidecar files.
  }
}

function stillStored(ctx: HostContext, sessionId: string, byId: Map<string, SessionHeaderLike>) {
  return byId.has(sessionId) || Boolean(ctx.sessions.get(sessionId))
}

async function logStillOnDisk(ctx: HostContext, sessionId: string, byId: Map<string, SessionHeaderLike>) {
  const header = byId.get(sessionId) ?? ctx.sessions.get(sessionId)?.header
  if (!header) return false
  const location = ctx.sessionPersistence.locate(header)
  if (!location) return Boolean(ctx.sessions.get(sessionId))
  const dir = dirname(location.path)
  for (const file of [location.path, join(dir, 'session.jsonl'), join(dir, 'session.jsonl.zstd')]) {
    try {
      await access(file)
      return true
    } catch {
      // Missing encoding sibling; try the next candidate.
    }
  }
  return false
}

async function listArchived(ctx: HostContext): Promise<ArchivedRow[]> {
  const ids = ctx.workspaceRegistry.archivedSessionIds.map(String)
  const headers = await ctx.sessionPersistence.list()
  const byId = new Map(headers.map((header) => [String(header.id), header]))
  const rows: ArchivedRow[] = []
  for (const id of ids) {
    if (!stillStored(ctx, id, byId) || !(await logStillOnDisk(ctx, id, byId))) continue
    const agent = ctx.agents.get(id)
    rows.push({
      id,
      cwd: byId.get(id)?.cwd ?? ctx.sessions.get(id)?.header.cwd,
      live: Boolean(ctx.sessions.get(id) || agent),
      running: agent?.status === 'running',
    })
  }
  return rows
}

async function deleteSession(ctx: HostContext, sessionId: string) {
  const agent = ctx.agents.get(sessionId)
  if (agent?.status === 'running') {
    const error = new Error('session is running; stop it before deleting')
    error.name = 'SessionPlusRunning'
    throw error
  }
  // Hide first and keep the tombstone in archivedSessionIds. Unarchiving after
  // rm() puts a file-less row back on the conversation list until restart.
  await hideFromGrouping(ctx, sessionId)
  await disposeLiveAgent(ctx, sessionId)
  await deleteArtifact(ctx, sessionId)
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
            const name = error instanceof Error ? error.name : ''
            const message = error instanceof Error ? error.message : String(error)
            logger.warn('dsh-session-plus route failed', error)
            if (name === 'SessionPlusRunning') {
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
