import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
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
  removeSessionDirectory,
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

function request(method: string, url: string, body?: unknown): IncomingMessage {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (payload) yield payload
    },
  } as IncomingMessage
}

function response() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    end(payload?: string) {
      this.body = payload ?? ''
    },
  }
}

async function call(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  method: string,
  url: string,
  body?: unknown,
) {
  const req = request(method, url, body)
  const res = response()
  await handler(req, res as unknown as ServerResponse)
  return { status: res.statusCode, json: JSON.parse(res.body) as Record<string, unknown> }
}

function harness(options: {
  root?: string
  listed: Listed[]
  live?: ReadonlySet<string>
  running?: ReadonlySet<string>
}) {
  const logs: string[] = []
  const archived: string[] = []
  let handler: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined
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
    workspaceRegistry: {
      archivedSessionIds: archived,
      async archiveSession(id: string) {
        archived.push(id)
      },
      async unarchiveSession() {},
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
    webServer: {
      register(route: { handler: typeof handler }) {
        handler = route.handler
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
  if (!handler) throw new Error('route was not registered')
  return { handler, logs, archived }
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
    const preview = await call(
      host.handler,
      'GET',
      '/api/session-plus/delete-preview?sessionId=sp-parent',
    )
    assert.equal(preview.status, 200)
    assert.equal(preview.json.descendantCount, 1)
    assert.deepEqual(preview.json.descendantIds, ['sp-child'])

    const deleted = await call(host.handler, 'POST', '/api/session-plus/delete', {
      sessionId: 'sp-parent',
      confirm: true,
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
    const result = await call(host.handler, 'POST', '/api/session-plus/delete', {
      sessionId: 'sp-open',
      confirm: true,
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
    const result = await call(host.handler, 'POST', '/api/session-plus/delete', {
      sessionId: 'sp-run',
      confirm: true,
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
    const linked = await call(host.handler, 'POST', '/api/session-plus/delete', {
      sessionId: 'sp-link',
      confirm: true,
    })
    assert.equal(linked.status, 200)
    assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'keep')
    assert.match(await readFile(join(outside, encoded, 'session.v4.jsonl'), 'utf8'), /sp-link/)

    const moved = await call(host.handler, 'POST', '/api/session-plus/delete', {
      sessionId: 'sp-move',
      confirm: true,
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
    const result = await call(host.handler, 'POST', '/api/session-plus/delete', {
      sessionId: 'sp-dup',
      confirm: true,
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
