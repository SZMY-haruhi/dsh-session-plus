import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { zstdCompressSync } from 'node:zlib'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/host/index.ts'
import {
  assertSessionsReleased,
  deletionIds,
  encodeSegment,
  projectKey,
  readStoredSessionId,
  removeSessionDirectory,
  requireZstdDecompress,
  sessionDirectory,
} from '../src/host/session-files.ts'

type Listed = {
  header: {
    id: string
    cwd: string
    parentSession?: string
    origin?: string
    isSeeded?: boolean
  }
  revision: string
}

type FetchRoute = {
  path: string
  methods: readonly string[]
  fetch: (request: Request) => Promise<Response>
}

type WebRoute = {
  kind?: string
  path?: string
  handler?: (req: unknown, res: unknown) => Promise<void>
}

function harness(options: {
  root?: string
  listed: Listed[]
  live?: ReadonlySet<string>
  running?: ReadonlySet<string>
  titles?: Record<string, string>
  /** Session ids whose title observation is rejected. */
  titleFailures?: readonly string[]
}) {
  const logs: string[] = []
  const archived: string[] = []
  const routes = new Map<string, FetchRoute>()
  const webRoutes: WebRoute[] = []
  let titleReads = 0
  const ctx = {
    logger: () => ({
      info: (...args: unknown[]) => {
        logs.push(args.map(String).join(' '))
      },
      warn: () => {},
    }),
    effect: (fn: () => void) => {
      fn()
    },
    get(name: string) {
      if (name !== 'sessionQuery' || !options.titles) return undefined
      return {
        async readTitleSnapshots(ids: readonly string[]) {
          titleReads += 1
          return ids.map((id) => {
            if (options.titleFailures?.includes(id)) {
              return { sessionId: id, status: 'rejected' as const, reason: new Error('title') }
            }
            const title = options.titles?.[id]
            return {
              sessionId: id,
              status: 'fulfilled' as const,
              value: title ? { title: { title } } : {},
            }
          })
        },
      }
    },
    workspaceRegistry: {
      archivedSessionIds: archived,
      async archiveSession(id: string) {
        archived.push(id)
      },
      async unarchiveSession(id: string) {
        const index = archived.indexOf(id)
        if (index >= 0) archived.splice(index, 1)
      },
    },
    sessionPersistence: {
      async list() {
        return options.listed
      },
      config: { root: options.root },
      locate() {
        throw new Error('locate must not be called')
      },
    },
    connection: {
      fetch: {
        register(route: FetchRoute) {
          routes.set(route.path, route)
          return async () => {
            routes.delete(route.path)
          }
        },
      },
    },
    webServer: {
      register(route: WebRoute) {
        webRoutes.push(route)
        return () => {}
      },
    },
    sessions: {
      get(id: string) {
        if (!options.live?.has(id)) return undefined
        return { header: { id, cwd: '/workspace' } }
      },
    },
    agents: {
      get(id: string) {
        if (!options.running?.has(id)) return undefined
        return { status: 'running' as const }
      },
    },
  }
  apply(ctx as unknown as Context)
  if (webRoutes.length > 0) throw new Error('webServer route would skip /api admission')

  async function call(method: string, url: string, body?: unknown, authenticated = true) {
    const pathname = new URL(url, 'http://session-plus.local').pathname
    const prefix = webRoutes
      .filter((route) => route.kind === 'prefix' && typeof route.path === 'string')
      .filter((route) => pathname === route.path || pathname.startsWith(`${route.path}/`))
      .sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))[0]
    if (prefix && (prefix.path?.length ?? 0) > '/api'.length) {
      return { status: 200, json: { ok: true, skippedAdmission: true }, text: '' }
    }
    if (!authenticated) return { status: 401, json: {}, text: 'unauthorized' }
    const route = routes.get(pathname)
    if (!route || !route.methods.includes(method)) return { status: 404, json: {}, text: 'not found' }
    const response = await route.fetch(
      new Request(`http://127.0.0.1${url}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      }),
    )
    const text = await response.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = {}
    }
    return { status: response.status, json, text }
  }

  return {
    call,
    logs,
    archived,
    routes,
    titleReads: () => titleReads,
  }
}

async function writeSession(root: string, id: string, cwd = '/workspace', compressed = false) {
  const dir = sessionDirectory(root, cwd, id)
  await mkdir(dir, { recursive: true })
  const line = `${JSON.stringify({ type: 'session', version: 4, id, cwd })}\n`
  if (compressed) {
    await writeFile(join(dir, 'session.v4.jsonl.zstd'), zstdCompressSync(Buffer.from(line)))
  } else {
    await writeFile(join(dir, 'session.v4.jsonl'), line)
  }
  return dir
}

test('deletion ids are subagents deepest-first, then the root', () => {
  const headers = [
    { id: 'root', cwd: '/work' },
    { id: 'fork', parentSession: 'root', isSeeded: true, cwd: '/work' },
    { id: 'child', parentSession: 'root', origin: 'subagent', cwd: '/work' },
    { id: 'grandchild', parentSession: 'child', origin: 'subagent', cwd: '/work' },
  ]
  assert.deepEqual(deletionIds(headers, 'root'), ['grandchild', 'child', 'root'])
})

test('an open session id refuses the whole delete plan', () => {
  assert.doesNotThrow(() => assertSessionsReleased(['child', 'root'], () => false))
  assert.throws(
    () => assertSessionsReleased(['child', 'root'], (id) => id === 'root'),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.name, 'SessionPlusOpen')
      assert.match(error.message, /root/)
      return true
    },
  )
})

test('removeSessionDirectory refuses a symlink and leaves the outside tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'sp-out-'))
  try {
    await writeFile(join(outside, 'keep.txt'), 'keep')
    const link = join(root, 'linked-session')
    await symlink(outside, link, 'dir')
    await assert.rejects(removeSessionDirectory(root, link), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.name, 'SessionPlusUnsafePath')
      return true
    })
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('cascade delete removes subagents, keeps forks, and logs ids first', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    const parent = await writeSession(root, 'sp-parent', '/workspace', true)
    const child = await writeSession(root, 'sp-child')
    const fork = await writeSession(root, 'sp-fork')
    const listed: Listed[] = [
      { header: { id: 'sp-parent', cwd: '/workspace' }, revision: '1' },
      { header: { id: 'sp-child', cwd: '/workspace', parentSession: 'sp-parent', origin: 'subagent' }, revision: '1' },
      { header: { id: 'sp-fork', cwd: '/workspace', parentSession: 'sp-parent', isSeeded: true }, revision: '1' },
    ]
    const host = harness({ root, listed })
    const preview = await host.call('GET', '/api/session-plus/delete-preview?sessionId=sp-parent')
    assert.equal(preview.status, 200)
    assert.equal(preview.json.descendantCount, 1)
    assert.deepEqual(preview.json.descendantIds, ['sp-child'])

    const deleted = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-parent',
      confirm: true,
      descendantIds: ['sp-child'],
    })
    assert.equal(deleted.status, 200)
    assert.deepEqual(host.archived, ['sp-child', 'sp-parent'])
    assert.ok(host.logs.some((line) => line === 'dsh-session-plus delete plan: sp-child sp-parent'))
    await assert.rejects(readFile(join(parent, 'session.v4.jsonl.zstd')))
    await assert.rejects(readFile(join(child, 'session.v4.jsonl')))
    assert.equal(await readFile(join(fork, 'session.v4.jsonl'), 'utf8') !== '', true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('delete returns 409 while the session is open and does not remove the directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    const dir = await writeSession(root, 'sp-open')
    const listed: Listed[] = [{ header: { id: 'sp-open', cwd: '/workspace' }, revision: '1' }]
    const host = harness({ root, listed, live: new Set(['sp-open']) })
    const result = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-open',
      confirm: true,
      descendantIds: [],
    })
    assert.equal(result.status, 409)
    assert.equal(result.json.code, 'open')
    assert.deepEqual(host.archived, [])
    assert.match(await readFile(join(dir, 'session.v4.jsonl'), 'utf8'), /sp-open/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a running session is refused before any directory is removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    const dir = await writeSession(root, 'sp-run')
    const host = harness({
      root,
      listed: [{ header: { id: 'sp-run', cwd: '/workspace' }, revision: '1' }],
      running: new Set(['sp-run']),
    })
    const result = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-run',
      confirm: true,
      descendantIds: [],
    })
    assert.equal(result.status, 409)
    assert.equal(result.json.code, 'running')
    assert.deepEqual(host.archived, [])
    assert.match(await readFile(join(dir, 'session.v4.jsonl'), 'utf8'), /sp-run/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a project symlink is not followed, and a mismatched header is not deleted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  const outside = await mkdtemp(join(tmpdir(), 'sp-out-'))
  try {
    await writeFile(join(outside, 'keep.txt'), 'keep')
    const encoded = encodeSegment('sp-link')
    await mkdir(join(outside, encoded), { recursive: true })
    await writeFile(
      join(outside, encoded, 'session.v4.jsonl'),
      `${JSON.stringify({ type: 'session', version: 4, id: 'sp-link', cwd: '/workspace' })}\n`,
    )
    await symlink(outside, join(root, projectKey('/workspace')), 'dir')

    const decoy = await writeSession(root, 'sp-move', '/workspace')
    await writeFile(
      join(decoy, 'session.v4.jsonl'),
      `${JSON.stringify({ type: 'session', version: 4, id: 'someone-else', cwd: '/workspace' })}\n`,
    )
    const real = await writeSession(root, 'sp-move', '/elsewhere')

    const host = harness({
      root,
      listed: [
        { header: { id: 'sp-link', cwd: '/workspace' }, revision: '1' },
        { header: { id: 'sp-move', cwd: '/workspace' }, revision: '1' },
      ],
    })
    const linked = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-link',
      confirm: true,
      descendantIds: [],
    })
    assert.equal(linked.status, 404)
    assert.equal(linked.json.code, 'not-found')
    assert.deepEqual(host.archived, [])
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep')
    assert.match(await readFile(join(outside, encoded, 'session.v4.jsonl'), 'utf8'), /sp-link/)

    const moved = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-move',
      confirm: true,
      descendantIds: [],
    })
    assert.equal(moved.status, 200)
    assert.match(await readFile(join(decoy, 'session.v4.jsonl'), 'utf8'), /someone-else/)
    await assert.rejects(readFile(join(real, 'session.v4.jsonl')))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('two matching headers outside the expected project are ambiguous', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    const left = await writeSession(root, 'sp-dup', '/left')
    const right = await writeSession(root, 'sp-dup', '/right')
    const host = harness({
      root,
      listed: [{ header: { id: 'sp-dup', cwd: '/workspace' }, revision: '1' }],
    })
    const result = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-dup',
      confirm: true,
      descendantIds: [],
    })
    assert.equal(result.status, 409)
    assert.equal(result.json.code, 'ambiguous')
    assert.deepEqual(host.archived, [])
    assert.match(await readFile(join(left, 'session.v4.jsonl'), 'utf8'), /sp-dup/)
    assert.match(await readFile(join(right, 'session.v4.jsonl'), 'utf8'), /sp-dup/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an anonymous delete is 401 and does not remove the directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    const dir = await writeSession(root, 'sp-secret')
    const host = harness({
      root,
      listed: [{ header: { id: 'sp-secret', cwd: '/workspace' }, revision: '1' }],
    })
    assert.equal(host.routes.has('/api/session-plus/delete'), true)
    const result = await host.call(
      'POST',
      '/api/session-plus/delete',
      { sessionId: 'sp-secret', confirm: true, descendantIds: [] },
      false,
    )
    assert.equal(result.status, 401)
    assert.equal(result.text, 'unauthorized')
    assert.deepEqual(host.archived, [])
    assert.match(await readFile(join(dir, 'session.v4.jsonl'), 'utf8'), /sp-secret/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a stale descendant list is 409 and a missing directory is 404', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    const parent = await writeSession(root, 'sp-parent')
    const child = await writeSession(root, 'sp-child')
    const host = harness({
      root,
      listed: [
        { header: { id: 'sp-parent', cwd: '/workspace' }, revision: '1' },
        { header: { id: 'sp-child', cwd: '/workspace', parentSession: 'sp-parent', origin: 'subagent' }, revision: '1' },
        { header: { id: 'sp-gone', cwd: '/workspace' }, revision: '1' },
      ],
    })
    const stale = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-parent',
      confirm: true,
      descendantIds: [],
    })
    assert.equal(stale.status, 409)
    assert.equal(stale.json.code, 'stale')
    assert.deepEqual(host.archived, [])
    assert.match(await readFile(join(parent, 'session.v4.jsonl'), 'utf8'), /sp-parent/)
    assert.match(await readFile(join(child, 'session.v4.jsonl'), 'utf8'), /sp-child/)

    const missing = await host.call('POST', '/api/session-plus/delete', {
      sessionId: 'sp-gone',
      confirm: true,
      descendantIds: [],
    })
    assert.equal(missing.status, 404)
    assert.equal(missing.json.code, 'not-found')
    assert.deepEqual(missing.json.missing, ['sp-gone'])
    assert.deepEqual(host.archived, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('archive rows include log-backed titles from one batch read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    await writeSession(root, 'sp-titled')
    await writeSession(root, 'sp-other')
    await writeSession(root, 'sp-untitled')
    const host = harness({
      root,
      listed: [
        { header: { id: 'sp-titled', cwd: '/workspace' }, revision: '1' },
        { header: { id: 'sp-other', cwd: '/workspace' }, revision: '1' },
        { header: { id: 'sp-untitled', cwd: '/workspace' }, revision: '1' },
      ],
      titles: { 'sp-titled': 'Edited branch', 'sp-other': 'Second' },
      titleFailures: ['sp-untitled'],
    })
    host.archived.push('sp-titled', 'sp-other', 'sp-untitled')
    const listed = await host.call('GET', '/api/session-plus/archived')
    assert.equal(listed.status, 200)
    const sessions = listed.json.sessions as { id: string; title?: string }[]
    assert.deepEqual(
      sessions.map((row) => [row.id, row.title]),
      [
        ['sp-titled', 'Edited branch'],
        ['sp-other', 'Second'],
        ['sp-untitled', undefined],
      ],
    )
    assert.equal(host.titleReads(), 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a missing zstd decoder fails explicitly', () => {
  assert.throws(
    () => requireZstdDecompress(null),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.name, 'SessionPlusZstdUnavailable')
      return true
    },
  )
})

test('readStoredSessionId stops at the first header line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-root-'))
  try {
    const plain = await writeSession(root, 'sp-plain')
    await writeFile(join(plain, 'session.v4.jsonl'), `{"id":"sp-plain"}\n${'x'.repeat(1024 * 256)}`, 'utf8')
    assert.equal(await readStoredSessionId(plain), 'sp-plain')

    const packed = await writeSession(root, 'sp-zstd', '/workspace', true)
    const header = zstdCompressSync(Buffer.from('{"id":"sp-zstd"}\n'))
    await writeFile(join(packed, 'session.v4.jsonl.zstd'), Buffer.concat([header, Buffer.alloc(1024 * 256, 7)]))
    assert.equal(await readStoredSessionId(packed), 'sp-zstd')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
