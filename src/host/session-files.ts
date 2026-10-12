import { isAbsolute, join, relative, resolve } from 'node:path'

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
 * A committed JSONL generation filename.
 * v0 keeps `session.jsonl[.zstd]`; v1 and later use `session.vN.jsonl[.zstd]`,
 * including the v3 files introduced in DSH 0.1.5 and the current v4 files.
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

export function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Absolute session directory for one header. The last segment is the encoded
 * id, and the directory stays inside `root`.
 */
export function resolveOwnedSessionDir(root: string, header: SessionHeaderLike): string {
  const dir = resolve(sessionDirectory(resolve(root), header.cwd, header.id))
  if (!isInsideRoot(root, dir)) throw new Error('session path escaped the persistence root')
  return dir
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
