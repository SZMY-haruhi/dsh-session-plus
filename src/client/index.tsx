import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'

type ArchivedRow = {
  id: string
  cwd?: string
  live: boolean
  running: boolean
}

type EditDraft = {
  sessionId: string
  nodeKey: string
  atSeq?: number
  draft: string
  title: string
}

type PanelState = {
  open: boolean
  pendingDelete?: string
  error?: string
  edit: EditDraft | null
}

type Translate = (key: string, params?: Record<string, unknown>) => string

const CSS = [
  '.sp_btn{box-sizing:border-box;appearance:none;border:0;background:transparent;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:8px;flex:none;width:100%;height:38px;margin:0;padding:0 10px;border-radius:10px;overflow:hidden}',
  '.sp_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
  '.sp_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.sp_btnRail{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:0 auto;padding:0}',
  '.sp_btnRail .sp_icon{width:18px;height:18px}',
  '.sp_icon{width:16px;height:16px;flex:none}',
  '.sp_label{white-space:nowrap;overflow:hidden;font-size:14px;line-height:22px;color:inherit}',
  '.sp_userChrome{display:flex;flex-direction:column;align-items:flex-end;width:100%}',
  '.sp_branchWrap{position:relative;display:flex;justify-content:flex-end}',
  '.sp_branchBtn{appearance:none;border:0;background:none;width:28px;height:28px;padding:6px;border-radius:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}',
  '.sp_branchBtn:hover,.sp_branchBtn:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
  '.sp_branchBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
  '.sp_tip{pointer-events:none;position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%);opacity:0;white-space:nowrap;padding:4px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;box-shadow:0 8px 20px rgba(0,0,0,.24)}',
  '.sp_branchBtn:hover .sp_tip,.sp_branchBtn:focus-visible .sp_tip{opacity:1}',
  '.sp_branchBtn[aria-expanded="true"] .sp_tip{display:none}',
  '.sp_branchPop{position:absolute;right:0;bottom:calc(100% + 6px);z-index:20;width:min(320px,calc(100vw - 48px));display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 12px 32px rgba(0,0,0,.28)}',
  '.sp_branchPop .sp_area{min-height:72px;width:100%;box-sizing:border-box}',
  '.sp_branchPop .sp_empty,.sp_branchPop .sp_error{margin:0}',
  '.sp_layer{position:fixed;inset:0;z-index:1000;pointer-events:none}',
  '.sp_scrim{position:absolute;inset:0;pointer-events:auto;background:rgba(0,0,0,.24)}',
  '.sp_panel{position:absolute;top:12px;bottom:12px;left:12px;width:min(360px,calc(100vw - 24px));pointer-events:auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden}',
  '.sp_head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.sp_title{flex:1;min-width:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.sp_close,.sp_mini{appearance:none;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:4px 10px;min-height:26px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;flex:none}',
  '.sp_close:hover,.sp_mini:hover{color:var(--dsw-alias-label-primary)}',
  '.sp_body{flex:1;min-height:0;overflow:auto;padding:10px 12px}',
  '.sp_section{margin:0 0 14px}',
  '.sp_h{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
  '.sp_row{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2)}',
  '.sp_name{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);word-break:break-word}',
  '.sp_meta{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
  '.sp_actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
  '.sp_mini.sp_danger,.sp_mini.sp_danger:hover,.sp_mini.sp_danger:focus,.sp_mini.sp_danger:focus-visible,.sp_mini.sp_danger:disabled{border:1px solid #ef4444 !important;background:#ef4444 !important;background-color:#ef4444 !important;color:#fff !important;filter:none}',
  '.sp_mini.sp_danger:hover,.sp_mini.sp_danger:focus,.sp_mini.sp_danger:focus-visible{border-color:#f87171 !important;background:#f87171 !important;background-color:#f87171 !important}',
  '.sp_mini.sp_danger:disabled{opacity:.55}',
  '.sp_modalLayer{position:fixed;inset:0;z-index:1100;pointer-events:auto;display:flex;align-items:center;justify-content:center}',
  '.sp_modalScrim{position:absolute;inset:0;appearance:none;border:0;padding:0;margin:0;background:rgba(0,0,0,.48);cursor:default}',
  '.sp_modal{position:relative;z-index:1;width:min(400px,calc(100vw - 48px));display:flex;flex-direction:column;gap:10px;padding:20px 20px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 20px 56px rgba(0,0,0,.45)}',
  '.sp_modalName{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-word}',
  '.sp_modalMsg{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
  '.sp_modalActions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}',
  '.sp_modalActions .sp_mini{min-height:32px;padding:6px 14px;font-size:13px}',
  '.sp_empty{margin:8px 0;font-size:13px;color:var(--dsw-alias-label-tertiary)}',
  '.sp_error{margin:0 12px 8px;font-size:12px;color:#ef4444}',
  '.sp_edit{display:flex;flex-direction:column;gap:8px}',
  '.sp_area{min-height:96px;resize:vertical;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}',
  '.sp_input{box-sizing:border-box;width:100%;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}',
  '.sp_input::placeholder,.sp_area::placeholder{color:var(--dsw-alias-label-tertiary)}',
].join('')

const en = {
  title: 'Session Plus',
  archive: 'Archive',
  current: 'Current session',
  archiveDir: 'Archive directory',
  empty: 'No archived sessions',
  none: 'No session selected',
  newSession: 'New session',
  blankHint: 'Empty draft — send a message first.',
  restore: 'Restore',
  delete: 'Delete',
  confirm: 'Delete this session? The log cannot be recovered.',
  cancel: 'Cancel',
  close: 'Close',
  hide: 'Archive',
  branch: 'Edit and branch',
  branchHint: 'Forks a new session here. The original stays.',
  branchName: 'New conversation name',
  branchNamePh: 'Optional — empty uses Title (1), (2), …',
  send: 'Send',
  running: 'Wait for the current turn to finish, or stop it first.',
}

const zh = {
  title: '会话补全',
  archive: '归档',
  current: '当前会话',
  archiveDir: '归档目录',
  empty: '没有已归档的会话',
  none: '还没有选中会话',
  newSession: '新会话',
  blankHint: '还是空白草稿，没有对话可归档。',
  restore: '恢复',
  delete: '删除',
  confirm: '确定删除这个会话？日志无法恢复。',
  cancel: '取消',
  close: '关闭',
  hide: '归档',
  branch: '修改并分支',
  branchHint: '从这里分出新会话，原对话还在。',
  branchName: '新对话名称',
  branchNamePh: '可不填，默认在原标题后叠加 (1) (2)…',
  send: '发送',
  running: '请先等当前回复结束，或点停止后再归档。',
}

function injectCss() {
  if (typeof document === 'undefined') return () => {}
  document.querySelector('style[data-session-plus-css]')?.remove()
  const tag = document.createElement('style')
  tag.setAttribute('data-session-plus-css', '1')
  tag.textContent = CSS
  document.body.appendChild(tag)
  return () => tag.remove()
}

function BranchIcon() {
  return (
    <svg className="sp_icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 14.25V8M8 8 3.5 3.5M8 8l4.5-4.5M3.5 5.35V3.5H5.35M12.5 5.35V3.5H10.65"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg className="sp_icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.5 2.5h11l.5 3h-12l.5-3Zm.5 4h10v7.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V6.5Zm3 2v1.5h4V8.5H6Z"
      />
    </svg>
  )
}

function createPanelStore(init: PanelState) {
  let state = init
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    update: (mutator: (draft: PanelState) => void) => {
      const draft = structuredClone(state)
      mutator(draft)
      state = draft
      for (const listener of listeners) listener()
    },
  }
}

const missingStore = {
  subscribe(listener: () => void) {
    void listener
    return () => {}
  },
  getSnapshot() {
    return undefined
  },
}

/**
 * Call getSnapshot as a method. Passing the unbound function into
 * useSyncExternalStore drops `this` on controller stores.
 * The hook itself always runs; a missing store reads as undefined.
 */
function useStore<T>(
  store: { getSnapshot: () => T; subscribe: (fn: () => void) => () => void } | null | undefined,
): T | undefined {
  const bound =
    store && typeof store.subscribe === 'function' && typeof store.getSnapshot === 'function'
      ? store
      : missingStore
  const subscribe = useCallback((onStoreChange: () => void) => bound.subscribe(onStoreChange), [bound])
  const getSnapshot = useCallback(() => bound.getSnapshot() as T | undefined, [bound])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

async function readApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const body = (await response.json()) as T & { ok?: boolean; error?: string; code?: string }
  if (!response.ok || body.ok === false) {
    const error = new Error(body.error ?? `HTTP ${response.status}`)
    ;(error as Error & { code?: string }).code = body.code
    throw error
  }
  return body
}

type SessionListSnap = {
  current?: string
  ids?: string[]
  byId?: Record<
    string,
    {
      displayTitle?: string
      title?: string
      blank?: boolean
      running?: boolean
      retainedBy?: { mainView?: number }
    }
  >
}

function sessionList(ctx: any): SessionListSnap | undefined {
  return ctx.sessions?.list?.getSnapshot?.() as SessionListSnap | undefined
}

function currentSessionId(list: SessionListSnap | undefined): string | undefined {
  if (!list) return undefined
  if (typeof list.current === 'string' && list.current.length > 0) return list.current
  const byId = list.byId ?? {}
  const ids = list.ids ?? Object.keys(byId)
  for (const id of ids) {
    if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id
  }
  for (const [id, row] of Object.entries(byId)) {
    if ((row?.retainedBy?.mainView ?? 0) > 0) return id
  }
  return undefined
}

function sessionRow(ctx: any, sessionId: string | undefined) {
  if (!sessionId) return undefined
  return sessionList(ctx)?.byId?.[sessionId]
}

function titleOf(ctx: any, sessionId: string, t?: Translate) {
  const row = sessionRow(ctx, sessionId)
  if (row?.blank) return t?.('newSession') ?? '新会话'
  return row?.displayTitle ?? row?.title ?? sessionId
}

function leaveIfCurrent(ctx: any, sessionId: string) {
  if (currentSessionId(sessionList(ctx)) !== sessionId) return
  if (typeof ctx.uiWorkspace?.startSession === 'function') {
    ctx.uiWorkspace.startSession()
    return
  }
  ctx.sessions?.clear?.()
}

function openSession(ctx: any, sessionId: string) {
  if (typeof ctx.uiWorkspace?.openSession === 'function') {
    ctx.uiWorkspace.openSession(sessionId)
    return
  }
  ctx.sessions?.open?.(sessionId)
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function sessionIsBusy(ctx: any, sessionId: string) {
  if (sessionList(ctx)?.byId?.[sessionId]?.running === true) return true
  const snap = ctx.sessions?.binding?.(sessionId)?.session?.getSnapshot?.() as
    | {
        running?: boolean
        partial?: unknown
        runningCalls?: readonly unknown[]
        awaitingFirstTurn?: boolean
        pendingSubmissions?: readonly unknown[]
      }
    | undefined
  if (!snap) return false
  return (
    snap.running === true ||
    snap.awaitingFirstTurn === true ||
    (snap.pendingSubmissions?.length ?? 0) > 0 ||
    snap.partial != null ||
    (snap.runningCalls?.length ?? 0) > 0
  )
}

async function waitUntilIdle(ctx: any, sessionId: string) {
  if (!sessionIsBusy(ctx, sessionId)) return
  for (let i = 0; i < 300; i++) {
    if (!sessionIsBusy(ctx, sessionId)) return
    await wait(100)
  }
  const error = new Error('running')
  ;(error as Error & { code?: string }).code = 'running'
  throw error
}

function textBlocks(content: readonly { type?: string; text?: string }[] | undefined) {
  if (!content) return ''
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

function sessionSnapshot(ctx: any, sessionId: string | undefined) {
  if (!sessionId) return undefined
  return ctx.sessions?.binding?.(sessionId)?.session?.getSnapshot?.()
}

function atSeqBeforeUser(snapshot: any, node: any): number | undefined {
  const seq = typeof node?.data?.seq === 'number' ? node.data.seq : undefined
  const loc = node?.location
  const turnNumber = loc?.kind === 'turn' || loc?.kind === 'step' ? loc.turn?.turn : undefined
  if (typeof turnNumber === 'number' && turnNumber > 1) {
    const end = snapshot?.turnEnds?.get?.(turnNumber - 1)
    if (typeof end === 'number') return end
  }
  const turnStart = loc?.kind === 'turn' || loc?.kind === 'step' ? loc.turn?.start?.seq : undefined
  if (typeof seq === 'number' && seq > 0) return seq - 1
  if (typeof turnStart === 'number' && turnStart > 0) return turnStart - 1
  return undefined
}

function draftFromUserNode(snapshot: any, node: any, sessionId: string): EditDraft | null {
  if (!node || !sessionId) return null
  return {
    sessionId: snapshot?.sessionId ?? sessionId,
    nodeKey: String(node.key ?? node.data?.seq ?? ''),
    atSeq: atSeqBeforeUser(snapshot, node),
    draft: textBlocks(node.data?.content),
    title: '',
  }
}

function officialUserRenderer(ctx: any) {
  const entries = (ctx.slots?.entries?.('conversation.chat.node') ?? []) as Array<{
    component?: unknown
    options?: { key?: string; priority?: number }
  }>
  return entries.find((entry) => entry.options?.key === 'user' && (entry.options?.priority ?? 0) === 0)?.component
}

export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace']

export function apply(ctx: any) {
  const tPlus = ctx.locale.bind('session-plus')
  const tConversation = ctx.locale.bind('conversation')
  const panel = createPanelStore({
    open: false,
    pendingDelete: undefined,
    error: undefined,
    edit: null,
  })

  function FooterButton(props: { wide?: boolean; t?: Translate }) {
    const t = props.t ?? ((key: string) => (zh as Record<string, string>)[key] ?? key)
    const state = useStore(panel)
    return (
      <button
        type="button"
        className={props.wide ? 'sp_btn' : 'sp_btn sp_btnRail'}
        aria-label={t('archive')}
        aria-pressed={state?.open ?? false}
        onClick={() =>
          panel.update((draft) => {
            draft.open = !draft.open
            draft.error = undefined
            if (!draft.open) draft.pendingDelete = undefined
          })
        }
      >
        <ArchiveIcon />
        {props.wide ? <span className="sp_label">{t('archive')}</span> : null}
      </button>
    )
  }

  function Overlay(props: { t?: Translate }) {
    const t = props.t ?? ((key: string) => (zh as Record<string, string>)[key] ?? key)
    const state = useStore(panel)
    const sessions = useStore<SessionListSnap>(ctx.sessions?.list)
    const workspaces = useStore<{ archivedSessionIds?: string[] }>(ctx.workspaces?.list)
    const [rows, setRows] = useState<ArchivedRow[]>([])
    const [busy, setBusy] = useState(false)
    const currentId = currentSessionId(sessions)
    const currentSummary = currentId ? sessions?.byId?.[currentId] : undefined
    const currentIsBlank = currentSummary?.blank === true
    const archivedIds = useMemo(
      () => new Set((workspaces?.archivedSessionIds ?? []).map(String)),
      [workspaces?.archivedSessionIds],
    )

    useEffect(() => {
      if (!state?.open) return
      let cancelled = false
      readApi<{ sessions: ArchivedRow[] }>('/api/session-plus/archived')
        .then((body) => {
          if (!cancelled) setRows(body.sessions ?? [])
        })
        .catch((error: Error) => {
          if (!cancelled) {
            panel.update((draft) => {
              draft.error = error.message
            })
          }
        })
      return () => {
        cancelled = true
      }
    }, [state?.open, workspaces?.archivedSessionIds, sessions?.ids])

    useEffect(() => {
      if (!state?.pendingDelete) return
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        panel.update((draft) => {
          draft.pendingDelete = undefined
        })
      }
      window.addEventListener('keydown', onKey, true)
      return () => window.removeEventListener('keydown', onKey, true)
    }, [state?.pendingDelete])

    async function run(action: () => Promise<void>) {
      setBusy(true)
      panel.update((draft) => {
        draft.error = undefined
      })
      try {
        await action()
      } catch (error) {
        const err = error as Error & { code?: string }
        panel.update((draft) => {
          draft.error = err.code === 'running' ? t('running') : err.message
        })
      } finally {
        setBusy(false)
      }
    }

    if (!state?.open) return null

    const pendingId = state.pendingDelete
    const pendingName = pendingId ? titleOf(ctx, pendingId, t) : ''

    function cancelDelete() {
      panel.update((draft) => {
        draft.pendingDelete = undefined
      })
    }

    function confirmDelete() {
      if (!pendingId || busy) return
      run(async () => {
        await waitUntilIdle(ctx, pendingId)
        leaveIfCurrent(ctx, pendingId)
        await readApi('/api/session-plus/delete', {
          method: 'POST',
          body: JSON.stringify({ sessionId: pendingId, confirm: true }),
        })
        setRows((current) => current.filter((row) => row.id !== pendingId))
        panel.update((draft) => {
          draft.pendingDelete = undefined
        })
      })
    }

    const visibleRows = rows

    return (
      <>
      <div className="sp_layer">
        <button
          type="button"
          className="sp_scrim"
          aria-label={t('close')}
          onClick={() => {
            if (panel.getSnapshot().pendingDelete) {
              panel.update((draft) => {
                draft.pendingDelete = undefined
              })
              return
            }
            panel.update((draft) => {
              draft.open = false
              draft.pendingDelete = undefined
            })
          }}
        />
        <aside className="sp_panel" role="dialog" aria-label={t('title')}>
          <div className="sp_head">
            <ArchiveIcon />
            <div className="sp_title">{t('title')}</div>
            <button
              type="button"
              className="sp_close"
              onClick={() =>
                panel.update((draft) => {
                  draft.open = false
                  draft.pendingDelete = undefined
                })
              }
            >
              {t('close')}
            </button>
          </div>
          {state.error ? <p className="sp_error">{state.error}</p> : null}
          <div className="sp_body">
            <div className="sp_section">
              <p className="sp_h">{t('current')}</p>
              {currentId && currentIsBlank ? (
                <div className="sp_row">
                  <div className="sp_name">{t('newSession')}</div>
                  <p className="sp_empty">{t('blankHint')}</p>
                </div>
              ) : currentId ? (
                <div className="sp_row">
                  <div className="sp_name">{titleOf(ctx, currentId, t)}</div>
                  <div className="sp_actions">
                    <button
                      type="button"
                      className="sp_mini"
                      disabled={busy || archivedIds.has(currentId)}
                      onClick={() =>
                        run(async () => {
                          await waitUntilIdle(ctx, currentId)
                          await ctx.workspaces?.archiveSession?.(currentId)
                          leaveIfCurrent(ctx, currentId)
                        })
                      }
                    >
                      {t('hide')}
                    </button>
                    <DeleteButton
                      t={t}
                      busy={busy}
                      onAsk={() =>
                        panel.update((draft) => {
                          draft.pendingDelete = currentId
                        })
                      }
                    />
                  </div>
                </div>
              ) : (
                <p className="sp_empty">{t('none')}</p>
              )}
            </div>

            <div className="sp_section">
              <p className="sp_h">{t('archiveDir')}</p>
              {visibleRows.length === 0 ? (
                <p className="sp_empty">{t('empty')}</p>
              ) : (
                visibleRows.map((row) => (
                  <div className="sp_row" key={row.id}>
                    <div className="sp_name">{titleOf(ctx, row.id, t)}</div>
                    {row.cwd ? <div className="sp_meta">{row.cwd}</div> : null}
                    <div className="sp_actions">
                      <button
                        type="button"
                        className="sp_mini"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await readApi('/api/session-plus/unarchive', {
                              method: 'POST',
                              body: JSON.stringify({ sessionId: row.id }),
                            })
                            if (sessionList(ctx)?.byId?.[row.id]) openSession(ctx, row.id)
                          })
                        }
                      >
                        {t('restore')}
                      </button>
                      <DeleteButton
                        t={t}
                        busy={busy}
                        onAsk={() =>
                          panel.update((draft) => {
                            draft.pendingDelete = row.id
                          })
                        }
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>
      </div>
      {pendingId ? (
        <div className="sp_modalLayer">
          <button type="button" className="sp_modalScrim" aria-label={t('cancel')} onClick={cancelDelete} />
          <div className="sp_modal" role="alertdialog" aria-modal="true" aria-labelledby="sp-del-name" aria-describedby="sp-del-msg">
            <p className="sp_modalName" id="sp-del-name">
              {pendingName}
            </p>
            <p className="sp_modalMsg" id="sp-del-msg">
              {t('confirm')}
            </p>
            <div className="sp_modalActions">
              <button type="button" className="sp_mini" autoFocus disabled={busy} onClick={cancelDelete}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="sp_mini sp_danger"
                style={{ background: '#ef4444', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
                disabled={busy}
                onClick={confirmDelete}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </>
    )
  }

  function wrapUserNode(Inner: any) {
    return function SessionPlusUserNode(props: any) {
      const state = useStore(panel)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState<string>()
      const nodeKey = String(props.node?.key ?? props.node?.data?.seq ?? '')
      const mine = state?.edit?.sessionId === props.sessionId && state?.edit?.nodeKey === nodeKey

      return (
        <div className="sp_userChrome">
          <Inner {...props} t={tConversation} />
          <div className="sp_branchWrap">
            <button
              type="button"
              className="sp_branchBtn"
              aria-label={tPlus('branch')}
              aria-expanded={mine}
              onClick={() => {
                if (mine) {
                  panel.update((next) => {
                    next.edit = null
                  })
                  setError(undefined)
                  return
                }
                const snapshot = sessionSnapshot(ctx, props.sessionId)
                const draft = draftFromUserNode(snapshot, props.node, props.sessionId)
                if (!draft) return
                panel.update((next) => {
                  next.edit = draft
                })
                setError(undefined)
              }}
            >
              <BranchIcon />
              <span className="sp_tip">{tPlus('branch')}</span>
            </button>
            {mine && state?.edit ? (
              <div className="sp_branchPop" role="dialog" aria-label={tPlus('branch')}>
                <p className="sp_empty">{tPlus('branchHint')}</p>
                <input
                  className="sp_input"
                  value={state.edit.title}
                  placeholder={tPlus('branchNamePh')}
                  aria-label={tPlus('branchName')}
                  onChange={(event) => {
                    const value = event.target.value
                    panel.update((draft) => {
                      if (draft.edit) draft.edit.title = value
                    })
                  }}
                />
                <textarea
                  className="sp_area"
                  value={state.edit.draft}
                  onChange={(event) => {
                    const value = event.target.value
                    panel.update((draft) => {
                      if (draft.edit) draft.edit.draft = value
                    })
                  }}
                />
                {error ? <p className="sp_error">{error}</p> : null}
                <div className="sp_actions">
                  <button
                    type="button"
                    className="sp_mini"
                    disabled={busy}
                    onClick={() => {
                      panel.update((draft) => {
                        draft.edit = null
                      })
                      setError(undefined)
                    }}
                  >
                    {tPlus('cancel')}
                  </button>
                  <button
                    type="button"
                    className="sp_mini"
                    disabled={busy || !state.edit.draft.trim()}
                    onClick={() => {
                      const edit = panel.getSnapshot().edit
                      if (!edit?.draft.trim()) return
                      setBusy(true)
                      setError(undefined)
                      void (async () => {
                        try {
                          const customTitle = edit.title.trim()
                          const childId = await ctx.sessions.fork({
                            sessionId: edit.sessionId,
                            atSeq: edit.atSeq,
                            increaseTitle: customTitle.length === 0,
                          })
                          // The web client has no sessions.open(). The workspace
                          // service retains the child on the main view, which is
                          // what makes sessions.binding() available.
                          openSession(ctx, childId)
                          let child = ctx.sessions.binding(childId)?.session
                          for (let i = 0; !child && i < 50; i++) {
                            await wait(100)
                            child = ctx.sessions.binding(childId)?.session
                          }
                          if (!child) throw new Error('forked session is not ready')
                          if (customTitle.length > 0) {
                            const renamed = await child.rename(customTitle)
                            if (renamed?.ok === false) {
                              throw new Error(renamed.error?.message ?? 'rename failed')
                            }
                          }
                          const result = await child.prompt([{ type: 'text', text: edit.draft.trim() }], 'queue')
                          if (result?.ok === false) {
                            throw new Error(result.error?.message ?? 'prompt failed')
                          }
                          panel.update((draft) => {
                            draft.edit = null
                          })
                        } catch (cause) {
                          setError((cause as Error).message)
                        } finally {
                          setBusy(false)
                        }
                      })()
                    }}
                  >
                    {tPlus('send')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )
    }
  }

  ctx.effect(() => injectCss(), 'session-plus css')
  ctx.effect(() => ctx.locale.register('session-plus', { en, zh }), 'session-plus locale')

  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          {
            name: 'sidebar.footer.action',
            id: 'session-plus',
            order: 30,
            locale: 'session-plus',
          },
          FooterButton,
        ),
      ),
    'session-plus footer',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'session-plus-panel',
            order: 30,
            locale: 'session-plus',
          },
          Overlay,
        ),
      ),
    'session-plus overlay',
  )

  ctx.effect(
    () =>
      ctx.slots.inject('conversation.chat.node', () => {
        let unreg: (() => void) | undefined
        const mount = () => {
          if (unreg) return
          const Inner = officialUserRenderer(ctx)
          if (Inner == null) return
          unreg = ctx.slots.register(
            {
              name: 'conversation.chat.node',
              key: 'user',
              priority: -1,
            },
            wrapUserNode(Inner),
          )
        }
        mount()
        const stop = ctx.slots.subscribe('conversation.chat.node', mount)
        return () => {
          stop()
          unreg?.()
        }
      }),
    'session-plus user edit',
  )
}

function DeleteButton(props: { t: Translate; busy: boolean; onAsk: () => void }) {
  return (
    <button
      type="button"
      className="sp_mini sp_danger"
      style={{ background: '#ef4444', backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
      disabled={props.busy}
      onClick={props.onAsk}
    >
      {props.t('delete')}
    </button>
  )
}
