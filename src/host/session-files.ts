import { lstat, open, readdir, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/**
 * Header fields this plugin reads. Logical headers from `list()` are already
 * translated to the current format; `origin` is what separates a subagent
 * child from a fork, which also stores `parentSession`.
 */
export type SessionHeaderLike = {
  id: string
  cwd?: string
  parentSession?: string
  origin?: string
  isSeeded?: boolean
}

const CANONICAL_LOG_NAME = /^session(?:\.v[1-9]\d*)?\.jsonl(?:\.zstd)?$/

/**
 * Whether this filename marks a directory as a committed session log.
 * v0 keeps `session.jsonl[.zstd]`; later generations use `session.vN.jsonl[.zstd]`.
 * A match only decides that the directory is a session directory.
 * Deletion removes the whole directory, not the matching file by itself.
 */
export function isCanonicalSessionLog(filename: string): boolean {
  return CANONICAL_LOG_NAME.test(filename)
}

/**
 * Accept both the current `list()` snapshot (`header` + `revision` +
 * optional `sizeBytes` / `eventCount`) and a pre-0.1.5 raw header.
 */
export function unwrapListedHeader(item: unknown): SessionHeaderLike | undefined {
  if (item === null || typeof item !== 'object') return undefined
  const record = item as Record<string, unknown>
  const nested = record.header
  if (nested !== null && typeof nested === 'object') {
    const header = headerFromRecord(nested as Record<string, unknown>)
    if (header) return header
  }
  return headerFromRecord(record)
}

export function indexHeaders(entries: readonly unknown[]): Map<string, SessionHeaderLike> {
  const byId = new Map<string, SessionHeaderLike>()
  for (const entry of entries) {
    const header = unwrapListedHeader(entry)
    if (header) byId.set(header.id, header)
  }
  return byId
}

/**
 * Subagent sessions to remove with `rootId`, deepest child first.
 * A fork records `parentSession` too, but it is an ordinary conversation
 * (`origin` is unset), so it is left on disk.
 */
export function subagentDescendants(
  headers: Iterable<SessionHeaderLike>,
  rootId: string,
): string[] {
  const byParent = new Map<string, string[]>()
  for (const header of headers) {
    if (header.origin !== 'subagent') continue
    if (!header.parentSession || header.parentSession === header.id) continue
    const children = byParent.get(header.parentSession)
    if (children) children.push(header.id)
    else byParent.set(header.parentSession, [header.id])
  }
  const ordered: string[] = []
  const seen = new Set<string>([rootId])
  const walk = (id: string) => {
    if (seen.has(id)) return
    seen.add(id)
    for (const child of byParent.get(id) ?? []) walk(child)
    ordered.push(id)
  }
  for (const child of byParent.get(rootId) ?? []) walk(child)
  return ordered
}

/**
 * Session ids are untrusted path segments. Match the JSONL backend's
 * injective encoding: safe ASCII stays literal, everything else (including
 * `~`) becomes `~XXXX`, and `.` / `..` cannot traverse.
 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/** Human-readable project directory key used under the persistence root. */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return `--${slug.slice(0, 251)}--`
}

export function sessionDirectory(root: string, cwd: string | undefined, id: string): string {
  const project = cwd === undefined ? join(root, '_no-cwd') : join(root, projectKey(cwd))
  return join(project, encodeSegment(id))
}

/**
 * Lexical containment for a path this process is about to build.
 * Deletion does not trust this alone: {@link confirmInsideRoot} compares
 * `realpath` of the root and the target, and {@link removeSessionDirectory}
 * `lstat`s again so a symlink or junction is refused.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Absolute session directory for one header. The last segment is the encoded
 * id. This check is lexical; the delete path realpath-checks the directory
 * that is actually on disk.
 */
export function resolveOwnedSessionDir(root: string, header: SessionHeaderLike): string {
  const dir = resolve(sessionDirectory(resolve(root), header.cwd, header.id))
  if (!isInsideRoot(root, dir)) throw new Error('session path escaped the persistence root')
  return dir
}

/** Ids removed with `rootId`, subagents deepest-first, then the root itself. */
export function deletionIds(headers: Iterable<SessionHeaderLike>, rootId: string): string[] {
  return [...subagentDescendants(headers, rootId), rootId]
}

/**
 * Refuse the whole delete when any planned id is still live in `ctx.sessions`.
 * An open session still owns a persistence handle; removing the directory
 * under that handle lets a later flush recreate an incomplete one.
 */
export function assertSessionsReleased(ids: readonly string[], isLive: (id: string) => boolean): void {
  const live = ids.find((id) => isLive(id))
  if (!live) return
  const error = new Error(`session ${live} is open in this process; close it before deleting`)
  error.name = 'SessionPlusOpen'
  throw error
}

/** True when both paths exist and the target's real path stays inside the root's. */
export async function confirmInsideRoot(root: string, target: string): Promise<boolean> {
  try {
    const rootReal = await realpath(root)
    const targetReal = await realpath(target)
    return isInsideRoot(rootReal, targetReal)
  } catch {
    return false
  }
}

const HEADER_LINE_LIMIT = 1024 * 1024

/**
 * `zstdDecompressSync` arrived in Node 22.15. On 22.6–22.14 the export is
 * missing; treating that as an unreadable header would archive the session
 * and still report success.
 */
export function requireZstdDecompress(decompress: unknown = zstdDecompressSync): (bytes: Buffer) => Buffer {
  if (typeof decompress !== 'function') {
    const error = new Error('node:zlib zstdDecompressSync requires Node.js >= 22.15')
    error.name = 'SessionPlusZstdUnavailable'
    throw error
  }
  return decompress as (bytes: Buffer) => Buffer
}

async function readFirstPlainLine(file: string): Promise<string | undefined> {
  const handle = await open(file, 'r')
  try {
    const chunks: Buffer[] = []
    let read = 0
    const buf = Buffer.alloc(4096)
    while (read < HEADER_LINE_LIMIT) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, HEADER_LINE_LIMIT - read), read)
      if (bytesRead === 0) break
      const slice = buf.subarray(0, bytesRead)
      const newline = slice.indexOf(0x0a)
      if (newline !== -1) {
        chunks.push(slice.subarray(0, newline))
        return Buffer.concat(chunks).toString('utf8').trim()
      }
      chunks.push(Buffer.from(slice))
      read += bytesRead
    }
    const text = Buffer.concat(chunks).toString('utf8').trim()
    return text.length > 0 ? text : undefined
  } finally {
    await handle.close()
  }
}

/** Decompress only until the first header line is complete. Later frames stay unread. */
async function readFirstZstdLine(file: string): Promise<string | undefined> {
  const decompress = requireZstdDecompress()
  const handle = await open(file, 'r')
  try {
    const chunks: Buffer[] = []
    let read = 0
    const buf = Buffer.alloc(8192)
    while (read < HEADER_LINE_LIMIT) {
      const { bytesRead } = await handle.read(buf, 0, Math.min(buf.length, HEADER_LINE_LIMIT - read), read)
      if (bytesRead === 0) break
      chunks.push(Buffer.from(buf.subarray(0, bytesRead)))
      read += bytesRead
      let text: string
      try {
        text = decompress(Buffer.concat(chunks)).toString('utf8')
      } catch {
        continue
      }
      const newline = text.indexOf('\n')
      if (newline === -1) continue
      const line = text.slice(0, newline).trim()
      if (line.length === 0) continue
      try {
        JSON.parse(line)
      } catch {
        continue
      }
      return line
    }
    return undefined
  } finally {
    await handle.close()
  }
}

/** Session id stored in one directory's committed log, if the header line can be read. */
export async function readStoredSessionId(dir: string): Promise<string | undefined> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return undefined
  }
  for (const name of names) {
    if (!isCanonicalSessionLog(name)) continue
    try {
      const line = name.endsWith('.zstd')
        ? await readFirstZstdLine(join(dir, name))
        : await readFirstPlainLine(join(dir, name))
      if (!line) continue
      const parsed: unknown = JSON.parse(line)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const id = (parsed as { id?: unknown }).id
      if (typeof id === 'string' && id.length > 0) return id
    } catch (error) {
      if (error instanceof Error && error.name === 'SessionPlusZstdUnavailable') throw error
      continue
    }
  }
  return undefined
}

async function directoryOwnedBy(dir: string, id: string): Promise<boolean> {
  try {
    const info = await lstat(dir)
    if (info.isSymbolicLink() || !info.isDirectory()) return false
  } catch {
    return false
  }
  return (await readStoredSessionId(dir)) === id
}

/**
 * Session directory whose on-disk header id is `header.id`.
 * The expected project path is preferred. Other project directories are
 * accepted only after the log header is read back and the id matches.
 * Symlinks are not session directories.
 */
export async function findSessionDirectory(
  root: string,
  header: SessionHeaderLike,
): Promise<string | undefined> {
  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch {
    return undefined
  }
  let expected: string | undefined
  try {
    expected = resolveOwnedSessionDir(rootReal, header)
  } catch {
    expected = undefined
  }
  if (expected && (await directoryOwnedBy(expected, header.id)) && (await confirmInsideRoot(rootReal, expected))) {
    return expected
  }
  const encoded = encodeSegment(header.id)
  let projects: { name: string; isDirectory: () => boolean }[]
  try {
    projects = await readdir(rootReal, { withFileTypes: true })
  } catch {
    return undefined
  }
  const matches: string[] = []
  for (const entry of projects) {
    if (!entry.isDirectory()) continue
    const candidate = resolve(rootReal, entry.name, encoded)
    if (candidate === expected) continue
    if (!isInsideRoot(rootReal, candidate)) continue
    if (!(await directoryOwnedBy(candidate, header.id))) continue
    if (!(await confirmInsideRoot(rootReal, candidate))) continue
    matches.push(candidate)
  }
  if (matches.length > 1) {
    const error = new Error('session id matches more than one persistence directory')
    error.name = 'SessionPlusAmbiguousArtifact'
    throw error
  }
  return matches[0]
}

/**
 * Remove one session directory that is a real directory inside `root`.
 * `lstat` runs again immediately before `rm` so a symlink swapped in
 * between the earlier check and the delete is not followed.
 */
export async function removeSessionDirectory(root: string, dir: string): Promise<void> {
  const refuse = (message: string) => {
    const error = new Error(message)
    error.name = 'SessionPlusUnsafePath'
    throw error
  }
  const inspect = async () => {
    const info = await lstat(dir)
    if (info.isSymbolicLink()) refuse('session directory is a symlink')
    if (!info.isDirectory()) refuse('session path is not a directory')
    if (!(await confirmInsideRoot(root, dir))) refuse('session path escaped the persistence root')
  }
  await inspect()
  await inspect()
  await rm(dir, { recursive: true, force: false })
}

function headerFromRecord(record: Record<string, unknown>): SessionHeaderLike | undefined {
  if (typeof record.id !== 'string') return undefined
  const id = record.id.trim()
  if (id.length === 0) return undefined
  const header: SessionHeaderLike = { id }
  if (typeof record.cwd === 'string' && record.cwd.length > 0) header.cwd = record.cwd
  if (typeof record.parentSession === 'string' && record.parentSession.length > 0) {
    header.parentSession = record.parentSession
  }
  if (typeof record.origin === 'string' && record.origin.length > 0) header.origin = record.origin
  if (typeof record.isSeeded === 'boolean') header.isSeeded = record.isSeeded
  return header
}
