import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  encodeSegment,
  indexHeaders,
  isCanonicalSessionLog,
  isInsideRoot,
  projectKey,
  resolveOwnedSessionDir,
  sessionDirectory,
  subagentDescendants,
  unwrapListedHeader,
} from '../src/host/session-files.ts'

test('unwraps a v3/v4 list snapshot and a legacy raw header', () => {
  const snapshot = unwrapListedHeader({
    header: {
      id: 'session-parent',
      cwd: '/workspace',
      parentSession: 'older',
      origin: 'subagent',
      isSeeded: false,
      version: 4,
    },
    revision: 'rev-1',
    sizeBytes: 128,
    eventCount: 3,
  })
  assert.deepEqual(snapshot, {
    id: 'session-parent',
    cwd: '/workspace',
    parentSession: 'older',
    origin: 'subagent',
    isSeeded: false,
  })

  const legacy = unwrapListedHeader({ id: 'legacy', cwd: '/tmp/project' })
  assert.equal(legacy?.id, 'legacy')
  assert.equal(legacy?.cwd, '/tmp/project')
  assert.equal(unwrapListedHeader({ revision: 'only' }), undefined)
  assert.equal(unwrapListedHeader(null), undefined)
})

test('indexes snapshots without treating the wrapper as the header', () => {
  const byId = indexHeaders([
    { header: { id: 'a', cwd: '/work' }, revision: 'r', sizeBytes: 10 },
    { id: 'b', cwd: '/legacy' },
    { header: { revision: 'missing-id' } },
  ])
  assert.deepEqual([...byId.keys()], ['a', 'b'])
  assert.equal(byId.get('a')?.cwd, '/work')
  assert.equal(byId.get('b')?.cwd, '/legacy')
})

test('cascade delete follows subagent origin and skips forks', () => {
  const headers = [
    { id: 'root', cwd: '/work', isSeeded: false },
    { id: 'fork', parentSession: 'root', isSeeded: true, cwd: '/work' },
    { id: 'child', parentSession: 'root', origin: 'subagent', cwd: '/work' },
    { id: 'grandchild', parentSession: 'child', origin: 'subagent', cwd: '/work' },
    { id: 'other', parentSession: 'elsewhere', origin: 'subagent', cwd: '/work' },
    { id: 'fork-of-child', parentSession: 'child', isSeeded: true, cwd: '/work' },
  ]
  assert.deepEqual(subagentDescendants(headers, 'root'), ['grandchild', 'child'])
  assert.deepEqual(subagentDescendants(headers, 'child'), ['grandchild'])
  assert.deepEqual(subagentDescendants(headers, 'missing'), [])
})

test('recognizes v0, v3, and v4 log filenames', () => {
  assert.equal(isCanonicalSessionLog('session.jsonl'), true)
  assert.equal(isCanonicalSessionLog('session.jsonl.zstd'), true)
  assert.equal(isCanonicalSessionLog('session.v3.jsonl.zstd'), true)
  assert.equal(isCanonicalSessionLog('session.v4.jsonl'), true)
  assert.equal(isCanonicalSessionLog('session.v4.jsonl.zstd'), true)
  assert.equal(isCanonicalSessionLog('session.v0.jsonl.zstd'), false)
  assert.equal(isCanonicalSessionLog('session.v03.jsonl.zstd'), false)
  assert.equal(isCanonicalSessionLog('session.lock'), false)
  assert.equal(isCanonicalSessionLog('session.v3.jsonl.zstd.tmp'), false)
})

test('session directory stays inside the persistence root', () => {
  const root = '/var/dsh/sessions'
  const dir = resolveOwnedSessionDir(root, { id: 'session-abc', cwd: '/workspace' })
  assert.equal(projectKey('/workspace'), '--workspace--')
  assert.equal(encodeSegment('session-abc'), 'session-abc')
  assert.equal(encodeSegment('..'), '~002E~002E')
  assert.equal(encodeSegment('../etc'), '..~002Fetc')
  assert.equal(dir, sessionDirectory(root, '/workspace', 'session-abc'))
  assert.equal(isInsideRoot(root, dir), true)
  assert.equal(sessionDirectory(root, undefined, 'solo'), `${root}/_no-cwd/solo`)
})
