window.__ModuleLoader__.load({
  id: "dsh-session-plus",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/index.tsx
const CSS = [
	".sp_btn{box-sizing:border-box;appearance:none;border:0;background:transparent;font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer;display:flex;align-items:center;gap:8px;flex:none;width:100%;height:38px;margin:0;padding:0 10px;border-radius:10px;overflow:hidden}",
	".sp_btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
	".sp_btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
	".sp_btnRail{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;margin:0 auto;padding:0}",
	".sp_btnRail .sp_icon{width:18px;height:18px}",
	".sp_icon{width:16px;height:16px;flex:none}",
	".sp_label{white-space:nowrap;overflow:hidden;font-size:14px;line-height:22px;color:inherit}",
	".sp_userChrome{display:flex;flex-direction:column;align-items:flex-end;width:100%}",
	".sp_branchWrap{position:relative;display:flex;justify-content:flex-end}",
	".sp_branchBtn{appearance:none;border:0;background:none;width:28px;height:28px;padding:6px;border-radius:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}",
	".sp_branchBtn:hover,.sp_branchBtn:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
	".sp_branchBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
	".sp_tip{pointer-events:none;position:absolute;right:calc(100% + 8px);top:50%;transform:translateY(-50%);opacity:0;white-space:nowrap;padding:4px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);font-size:12px;line-height:18px;box-shadow:0 8px 20px rgba(0,0,0,.24)}",
	".sp_branchBtn:hover .sp_tip,.sp_branchBtn:focus-visible .sp_tip{opacity:1}",
	".sp_branchBtn[aria-expanded=\"true\"] .sp_tip{display:none}",
	".sp_branchPop{position:absolute;right:0;bottom:calc(100% + 6px);z-index:20;width:min(320px,calc(100vw - 48px));display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 12px 32px rgba(0,0,0,.28)}",
	".sp_branchPop .sp_area{min-height:72px;width:100%;box-sizing:border-box}",
	".sp_branchPop .sp_empty,.sp_branchPop .sp_error{margin:0}",
	".sp_layer{position:fixed;inset:0;z-index:1000;pointer-events:none}",
	".sp_scrim{position:absolute;inset:0;pointer-events:auto;background:rgba(0,0,0,.24)}",
	".sp_panel{position:absolute;top:12px;bottom:12px;left:12px;width:min(360px,calc(100vw - 24px));pointer-events:auto;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 12px 40px rgba(0,0,0,.28);overflow:hidden}",
	".sp_head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
	".sp_title{flex:1;min-width:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}",
	".sp_close,.sp_mini{appearance:none;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:none;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:4px 10px;min-height:26px;font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;flex:none}",
	".sp_close:hover,.sp_mini:hover{color:var(--dsw-alias-label-primary)}",
	".sp_body{flex:1;min-height:0;overflow:auto;padding:10px 12px}",
	".sp_section{margin:0 0 14px}",
	".sp_h{margin:0 0 8px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}",
	".sp_row{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2)}",
	".sp_name{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);word-break:break-word}",
	".sp_meta{font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all}",
	".sp_actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
	".sp_mini.sp_danger,.sp_mini.sp_danger:hover,.sp_mini.sp_danger:focus,.sp_mini.sp_danger:focus-visible,.sp_mini.sp_danger:disabled{border:1px solid #ef4444 !important;background:#ef4444 !important;background-color:#ef4444 !important;color:#fff !important;filter:none}",
	".sp_mini.sp_danger:hover,.sp_mini.sp_danger:focus,.sp_mini.sp_danger:focus-visible{border-color:#f87171 !important;background:#f87171 !important;background-color:#f87171 !important}",
	".sp_mini.sp_danger:disabled{opacity:.55}",
	".sp_modalLayer{position:fixed;inset:0;z-index:1100;pointer-events:auto;display:flex;align-items:center;justify-content:center}",
	".sp_modalScrim{position:absolute;inset:0;appearance:none;border:0;padding:0;margin:0;background:rgba(0,0,0,.48);cursor:default}",
	".sp_modal{position:relative;z-index:1;width:min(400px,calc(100vw - 48px));display:flex;flex-direction:column;gap:10px;padding:20px 20px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-layer-3);box-shadow:0 20px 56px rgba(0,0,0,.45)}",
	".sp_modalName{margin:0;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-word}",
	".sp_modalMsg{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
	".sp_modalActions{display:flex;justify-content:flex-end;gap:8px;margin-top:6px}",
	".sp_modalActions .sp_mini{min-height:32px;padding:6px 14px;font-size:13px}",
	".sp_empty{margin:8px 0;font-size:13px;color:var(--dsw-alias-label-tertiary)}",
	".sp_error{margin:0 12px 8px;font-size:12px;color:#ef4444}",
	".sp_modal .sp_error{margin:0}",
	".sp_edit{display:flex;flex-direction:column;gap:8px}",
	".sp_area{min-height:96px;resize:vertical;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
	".sp_input{box-sizing:border-box;width:100%;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}",
	".sp_input::placeholder,.sp_area::placeholder{color:var(--dsw-alias-label-tertiary)}"
].join("");
const en = {
	title: "Session Plus",
	archive: "Archive",
	current: "Current session",
	archiveDir: "Archive directory",
	empty: "No archived sessions",
	none: "No session selected",
	newSession: "New session",
	blankHint: "Empty draft — send a message first.",
	restore: "Restore",
	delete: "Delete",
	confirm: "This also deletes {count} sub-agent session(s). The logs cannot be recovered.",
	confirmLoading: "Checking how many sub-agent sessions this deletes…",
	open: "This session is still open in this process. Close it before deleting.",
	cancel: "Cancel",
	close: "Close",
	hide: "Archive",
	branch: "Edit and branch",
	branchHint: "Forks a new session here. The original stays.",
	branchName: "New conversation name",
	branchNamePh: "Optional — empty uses Title (1), (2), …",
	send: "Send",
	running: "Wait for the current turn to finish, or stop it first."
};
const zh = {
	title: "会话补全",
	archive: "归档",
	current: "当前会话",
	archiveDir: "归档目录",
	empty: "没有已归档的会话",
	none: "还没有选中会话",
	newSession: "新会话",
	blankHint: "还是空白草稿，没有对话可归档。",
	restore: "恢复",
	delete: "删除",
	confirm: "这会一并删除 {count} 个子代理会话。日志无法恢复。",
	confirmLoading: "正在统计要删除的子代理会话…",
	open: "这个会话还在当前进程里打开着，请先关闭再删除。",
	cancel: "取消",
	close: "关闭",
	hide: "归档",
	branch: "修改并分支",
	branchHint: "从这里分出新会话，原对话还在。",
	branchName: "新对话名称",
	branchNamePh: "可不填，默认在原标题后叠加 (1) (2)…",
	send: "发送",
	running: "请先等当前回复结束，或点停止后再归档。"
};
function injectCss() {
	if (typeof document === "undefined") return () => {};
	document.querySelector("style[data-session-plus-css]")?.remove();
	const tag = document.createElement("style");
	tag.setAttribute("data-session-plus-css", "1");
	tag.textContent = CSS;
	document.body.appendChild(tag);
	return () => tag.remove();
}
function BranchIcon() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
		className: "sp_icon",
		viewBox: "0 0 16 16",
		fill: "none",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
			d: "M8 14.25V8M8 8 3.5 3.5M8 8l4.5-4.5M3.5 5.35V3.5H5.35M12.5 5.35V3.5H10.65",
			stroke: "currentColor",
			strokeWidth: "1.5",
			strokeLinecap: "round",
			strokeLinejoin: "round"
		})
	});
}
function ArchiveIcon() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
		className: "sp_icon",
		viewBox: "0 0 16 16",
		"aria-hidden": "true",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
			fill: "currentColor",
			d: "M2.5 2.5h11l.5 3h-12l.5-3Zm.5 4h10v7.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V6.5Zm3 2v1.5h4V8.5H6Z"
		})
	});
}
function createPanelStore(init) {
	let state = init;
	const listeners = /* @__PURE__ */ new Set();
	return {
		getSnapshot: () => state,
		subscribe: (fn) => {
			listeners.add(fn);
			return () => {
				listeners.delete(fn);
			};
		},
		update: (mutator) => {
			const draft = structuredClone(state);
			mutator(draft);
			state = draft;
			for (const listener of listeners) listener();
		}
	};
}
const missingStore = {
	subscribe(listener) {
		return () => {};
	},
	getSnapshot() {}
};
/**
* Call getSnapshot as a method. Passing the unbound function into
* useSyncExternalStore drops `this` on controller stores.
* The hook itself always runs; a missing store reads as undefined.
*/
function useStore(store) {
	const bound = store && typeof store.subscribe === "function" && typeof store.getSnapshot === "function" ? store : missingStore;
	const subscribe = (0, react.useCallback)((onStoreChange) => bound.subscribe(onStoreChange), [bound]);
	const getSnapshot = (0, react.useCallback)(() => bound.getSnapshot(), [bound]);
	return (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
}
async function readApi(path, init) {
	const response = await fetch(path, {
		...init,
		headers: {
			accept: "application/json",
			...init?.body ? { "content-type": "application/json" } : {},
			...init?.headers
		}
	});
	const body = await response.json();
	if (!response.ok || body.ok === false) {
		const error = new Error(body.error ?? `HTTP ${response.status}`);
		error.code = body.code;
		throw error;
	}
	return body;
}
function sessionList(ctx) {
	return ctx.sessions?.list?.getSnapshot?.();
}
function currentSessionId(list) {
	if (!list) return void 0;
	if (typeof list.current === "string" && list.current.length > 0) return list.current;
	const byId = list.byId ?? {};
	const ids = list.ids ?? Object.keys(byId);
	for (const id of ids) if ((byId[id]?.retainedBy?.mainView ?? 0) > 0) return id;
	for (const [id, row] of Object.entries(byId)) if ((row?.retainedBy?.mainView ?? 0) > 0) return id;
}
function sessionRow(ctx, sessionId) {
	if (!sessionId) return void 0;
	return sessionList(ctx)?.byId?.[sessionId];
}
function presentTitle(value) {
	if (typeof value !== "string") return void 0;
	const text = value.trim();
	return text.length > 0 ? text : void 0;
}
function titleOf(ctx, sessionId, t) {
	const row = sessionRow(ctx, sessionId);
	if (row?.blank) return t?.("newSession") ?? "新会话";
	return presentTitle(row?.title) ?? presentTitle(row?.displayTitle) ?? sessionId;
}
function leaveIfCurrent(ctx, sessionId) {
	if (currentSessionId(sessionList(ctx)) !== sessionId) return;
	if (typeof ctx.uiWorkspace?.startSession === "function") {
		ctx.uiWorkspace.startSession();
		return;
	}
	ctx.sessions?.clear?.();
}
function openSession(ctx, sessionId) {
	if (typeof ctx.uiWorkspace?.openSession === "function") {
		ctx.uiWorkspace.openSession(sessionId);
		return;
	}
	ctx.sessions?.open?.(sessionId);
}
function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
function sessionIsBusy(ctx, sessionId) {
	if (sessionList(ctx)?.byId?.[sessionId]?.running === true) return true;
	const snap = ctx.sessions?.binding?.(sessionId)?.session?.getSnapshot?.();
	if (!snap) return false;
	return snap.running === true || snap.awaitingFirstTurn === true || (snap.pendingSubmissions?.length ?? 0) > 0 || snap.partial != null || (snap.runningCalls?.length ?? 0) > 0;
}
async function waitUntilIdle(ctx, sessionId) {
	if (!sessionIsBusy(ctx, sessionId)) return;
	for (let i = 0; i < 300; i++) {
		if (!sessionIsBusy(ctx, sessionId)) return;
		await wait(100);
	}
	const error = /* @__PURE__ */ new Error("running");
	error.code = "running";
	throw error;
}
function textBlocks(content) {
	if (!content) return "";
	return content.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
}
function sessionSnapshot(ctx, sessionId) {
	if (!sessionId) return void 0;
	return ctx.sessions?.binding?.(sessionId)?.session?.getSnapshot?.();
}
function atSeqBeforeUser(snapshot, node) {
	const seq = typeof node?.data?.seq === "number" ? node.data.seq : void 0;
	const loc = node?.location;
	const turnNumber = loc?.kind === "turn" || loc?.kind === "step" ? loc.turn?.turn : void 0;
	if (typeof turnNumber === "number" && turnNumber > 1) {
		const end = snapshot?.turnEnds?.get?.(turnNumber - 1);
		if (typeof end === "number") return end;
	}
	const turnStart = loc?.kind === "turn" || loc?.kind === "step" ? loc.turn?.start?.seq : void 0;
	if (typeof seq === "number" && seq > 0) return seq - 1;
	if (typeof turnStart === "number" && turnStart > 0) return turnStart - 1;
}
function draftFromUserNode(snapshot, node, sessionId) {
	if (!node || !sessionId) return null;
	return {
		sessionId: snapshot?.sessionId ?? sessionId,
		nodeKey: String(node.key ?? node.data?.seq ?? ""),
		atSeq: atSeqBeforeUser(snapshot, node),
		draft: textBlocks(node.data?.content),
		title: ""
	};
}
function officialUserRenderer(ctx) {
	return (ctx.slots?.entries?.("conversation.chat.node") ?? []).find((entry) => entry.options?.key === "user" && (entry.options?.priority ?? 0) === 0)?.component;
}
const inject = [
	"slots",
	"locale",
	"sessions",
	"workspaces",
	"uiWorkspace"
];
function apply(ctx) {
	const tPlus = ctx.locale.bind("session-plus");
	const tConversation = ctx.locale.bind("conversation");
	const panel = createPanelStore({
		open: false,
		pendingDelete: void 0,
		error: void 0,
		edit: null
	});
	function FooterButton(props) {
		const t = props.t ?? ((key) => zh[key] ?? key);
		const state = useStore(panel);
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			type: "button",
			className: props.wide ? "sp_btn" : "sp_btn sp_btnRail",
			"aria-label": t("archive"),
			"aria-pressed": state?.open ?? false,
			onClick: () => panel.update((draft) => {
				draft.open = !draft.open;
				draft.error = void 0;
				if (!draft.open) draft.pendingDelete = void 0;
			}),
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveIcon, {}), props.wide ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "sp_label",
				children: t("archive")
			}) : null]
		});
	}
	function Overlay(props) {
		const t = props.t ?? ((key) => zh[key] ?? key);
		const state = useStore(panel);
		const sessions = useStore(ctx.sessions?.list);
		const workspaces = useStore(ctx.workspaces?.list);
		const [rows, setRows] = (0, react.useState)([]);
		const [busy, setBusy] = (0, react.useState)(false);
		const [preview, setPreview] = (0, react.useState)(null);
		const [previewError, setPreviewError] = (0, react.useState)();
		const currentId = currentSessionId(sessions);
		const currentIsBlank = (currentId ? sessions?.byId?.[currentId] : void 0)?.blank === true;
		const archivedIds = (0, react.useMemo)(() => new Set((workspaces?.archivedSessionIds ?? []).map(String)), [workspaces?.archivedSessionIds]);
		(0, react.useEffect)(() => {
			if (!state?.open) return;
			let cancelled = false;
			readApi("/api/session-plus/archived").then((body) => {
				if (!cancelled) setRows(body.sessions ?? []);
			}).catch((error) => {
				if (!cancelled) panel.update((draft) => {
					draft.error = error.message;
				});
			});
			return () => {
				cancelled = true;
			};
		}, [
			state?.open,
			workspaces?.archivedSessionIds,
			sessions?.ids
		]);
		(0, react.useEffect)(() => {
			const id = state?.pendingDelete;
			if (!id) {
				setPreview(null);
				setPreviewError(void 0);
				return;
			}
			let cancelled = false;
			setPreview(null);
			setPreviewError(void 0);
			readApi(`/api/session-plus/delete-preview?sessionId=${encodeURIComponent(id)}`).then((body) => {
				if (!cancelled) setPreview({
					id,
					count: body.descendantCount ?? 0
				});
			}).catch((error) => {
				if (!cancelled) setPreviewError(error.message);
			});
			return () => {
				cancelled = true;
			};
		}, [state?.pendingDelete]);
		(0, react.useEffect)(() => {
			if (!state?.pendingDelete) return;
			const onKey = (event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				event.stopPropagation();
				panel.update((draft) => {
					draft.pendingDelete = void 0;
				});
			};
			window.addEventListener("keydown", onKey, true);
			return () => window.removeEventListener("keydown", onKey, true);
		}, [state?.pendingDelete]);
		async function run(action) {
			setBusy(true);
			panel.update((draft) => {
				draft.error = void 0;
			});
			try {
				await action();
			} catch (error) {
				const err = error;
				panel.update((draft) => {
					draft.error = err.code === "running" ? t("running") : err.code === "open" ? t("open") : err.message;
				});
			} finally {
				setBusy(false);
			}
		}
		if (!state?.open) return null;
		const pendingId = state.pendingDelete;
		const pendingName = pendingId ? titleOf(ctx, pendingId, t) : "";
		const previewReady = Boolean(pendingId && preview?.id === pendingId);
		function cancelDelete() {
			panel.update((draft) => {
				draft.pendingDelete = void 0;
				draft.error = void 0;
			});
		}
		function confirmDelete() {
			if (!pendingId || busy || !previewReady) return;
			run(async () => {
				await waitUntilIdle(ctx, pendingId);
				await readApi("/api/session-plus/delete", {
					method: "POST",
					body: JSON.stringify({
						sessionId: pendingId,
						confirm: true
					})
				});
				leaveIfCurrent(ctx, pendingId);
				setRows((current) => current.filter((row) => row.id !== pendingId));
				panel.update((draft) => {
					draft.pendingDelete = void 0;
				});
			});
		}
		const visibleRows = rows;
		return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "sp_layer",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "sp_scrim",
				"aria-label": t("close"),
				onClick: () => {
					if (panel.getSnapshot().pendingDelete) {
						panel.update((draft) => {
							draft.pendingDelete = void 0;
						});
						return;
					}
					panel.update((draft) => {
						draft.open = false;
						draft.pendingDelete = void 0;
					});
				}
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("aside", {
				className: "sp_panel",
				role: "dialog",
				"aria-label": t("title"),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "sp_head",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveIcon, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "sp_title",
								children: t("title")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "sp_close",
								onClick: () => panel.update((draft) => {
									draft.open = false;
									draft.pendingDelete = void 0;
								}),
								children: t("close")
							})
						]
					}),
					state.error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "sp_error",
						children: state.error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "sp_body",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "sp_section",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "sp_h",
								children: t("current")
							}), currentId && currentIsBlank ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "sp_row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "sp_name",
									children: t("newSession")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "sp_empty",
									children: t("blankHint")
								})]
							}) : currentId ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "sp_row",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "sp_name",
									children: titleOf(ctx, currentId, t)
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "sp_actions",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "sp_mini",
										disabled: busy || archivedIds.has(currentId),
										onClick: () => run(async () => {
											await waitUntilIdle(ctx, currentId);
											await ctx.workspaces?.archiveSession?.(currentId);
											leaveIfCurrent(ctx, currentId);
										}),
										children: t("hide")
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeleteButton, {
										t,
										busy,
										onAsk: () => panel.update((draft) => {
											draft.pendingDelete = currentId;
											draft.error = void 0;
										})
									})]
								})]
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "sp_empty",
								children: t("none")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "sp_section",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "sp_h",
								children: t("archiveDir")
							}), visibleRows.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "sp_empty",
								children: t("empty")
							}) : visibleRows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "sp_row",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "sp_name",
										children: titleOf(ctx, row.id, t)
									}),
									row.cwd ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "sp_meta",
										children: row.cwd
									}) : null,
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "sp_actions",
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: "sp_mini",
											disabled: busy,
											onClick: () => run(async () => {
												await readApi("/api/session-plus/unarchive", {
													method: "POST",
													body: JSON.stringify({ sessionId: row.id })
												});
												if (sessionList(ctx)?.byId?.[row.id]) openSession(ctx, row.id);
											}),
											children: t("restore")
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DeleteButton, {
											t,
											busy,
											onAsk: () => panel.update((draft) => {
												draft.pendingDelete = row.id;
												draft.error = void 0;
											})
										})]
									})
								]
							}, row.id))]
						})]
					})
				]
			})]
		}), pendingId ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "sp_modalLayer",
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "sp_modalScrim",
				"aria-label": t("cancel"),
				onClick: cancelDelete
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "sp_modal",
				role: "alertdialog",
				"aria-modal": "true",
				"aria-labelledby": "sp-del-name",
				"aria-describedby": "sp-del-msg",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "sp_modalName",
						id: "sp-del-name",
						children: pendingName
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "sp_modalMsg",
						id: "sp-del-msg",
						children: previewReady ? t("confirm", { count: preview?.count ?? 0 }) : previewError ?? t("confirmLoading")
					}),
					state.error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "sp_error",
						children: state.error
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "sp_modalActions",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "sp_mini",
							autoFocus: true,
							disabled: busy,
							onClick: cancelDelete,
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "sp_mini sp_danger",
							style: {
								background: "#ef4444",
								backgroundColor: "#ef4444",
								borderColor: "#ef4444",
								color: "#fff"
							},
							disabled: busy || !previewReady,
							onClick: confirmDelete,
							children: t("delete")
						})]
					})
				]
			})]
		}) : null] });
	}
	function wrapUserNode(Inner) {
		return function SessionPlusUserNode(props) {
			const state = useStore(panel);
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const nodeKey = String(props.node?.key ?? props.node?.data?.seq ?? "");
			const mine = state?.edit?.sessionId === props.sessionId && state?.edit?.nodeKey === nodeKey;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "sp_userChrome",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Inner, {
					...props,
					t: tConversation
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "sp_branchWrap",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "sp_branchBtn",
						"aria-label": tPlus("branch"),
						"aria-expanded": mine,
						onClick: () => {
							if (mine) {
								panel.update((next) => {
									next.edit = null;
								});
								setError(void 0);
								return;
							}
							const draft = draftFromUserNode(sessionSnapshot(ctx, props.sessionId), props.node, props.sessionId);
							if (!draft) return;
							panel.update((next) => {
								next.edit = draft;
							});
							setError(void 0);
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BranchIcon, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "sp_tip",
							children: tPlus("branch")
						})]
					}), mine && state?.edit ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "sp_branchPop",
						role: "dialog",
						"aria-label": tPlus("branch"),
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "sp_empty",
								children: tPlus("branchHint")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: "sp_input",
								value: state.edit.title,
								placeholder: tPlus("branchNamePh"),
								"aria-label": tPlus("branchName"),
								onChange: (event) => {
									const value = event.target.value;
									panel.update((draft) => {
										if (draft.edit) draft.edit.title = value;
									});
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								className: "sp_area",
								value: state.edit.draft,
								onChange: (event) => {
									const value = event.target.value;
									panel.update((draft) => {
										if (draft.edit) draft.edit.draft = value;
									});
								}
							}),
							error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "sp_error",
								children: error
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "sp_actions",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "sp_mini",
									disabled: busy,
									onClick: () => {
										panel.update((draft) => {
											draft.edit = null;
										});
										setError(void 0);
									},
									children: tPlus("cancel")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "sp_mini",
									disabled: busy || !state.edit.draft.trim(),
									onClick: () => {
										const edit = panel.getSnapshot().edit;
										if (!edit?.draft.trim()) return;
										setBusy(true);
										setError(void 0);
										(async () => {
											try {
												const customTitle = edit.title.trim();
												const childId = await ctx.sessions.fork({
													sessionId: edit.sessionId,
													atSeq: edit.atSeq,
													increaseTitle: customTitle.length === 0
												});
												openSession(ctx, childId);
												let child = ctx.sessions.binding(childId)?.session;
												for (let i = 0; !child && i < 50; i++) {
													await wait(100);
													child = ctx.sessions.binding(childId)?.session;
												}
												if (!child) throw new Error("forked session is not ready");
												if (customTitle.length > 0) {
													const renamed = await child.rename(customTitle);
													if (renamed?.ok === false) throw new Error(renamed.error?.message ?? "rename failed");
												}
												const result = await child.prompt([{
													type: "text",
													text: edit.draft.trim()
												}], "queue");
												if (result?.ok === false) throw new Error(result.error?.message ?? "prompt failed");
												panel.update((draft) => {
													draft.edit = null;
												});
											} catch (cause) {
												setError(cause.message);
											} finally {
												setBusy(false);
											}
										})();
									},
									children: tPlus("send")
								})]
							})
						]
					}) : null]
				})]
			});
		};
	}
	ctx.effect(() => injectCss(), "session-plus css");
	ctx.effect(() => ctx.locale.register("session-plus", {
		en,
		zh
	}), "session-plus locale");
	ctx.effect(() => ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
		name: "sidebar.footer.action",
		id: "session-plus",
		order: 30,
		locale: "session-plus"
	}, FooterButton)), "session-plus footer");
	ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
		name: "shell.overlay",
		id: "session-plus-panel",
		order: 30,
		locale: "session-plus"
	}, Overlay)), "session-plus overlay");
	ctx.effect(() => ctx.slots.inject("conversation.chat.node", () => {
		let unreg;
		const mount = () => {
			if (unreg) return;
			const Inner = officialUserRenderer(ctx);
			if (Inner == null) return;
			unreg = ctx.slots.register({
				name: "conversation.chat.node",
				key: "user",
				priority: -1
			}, wrapUserNode(Inner));
		};
		mount();
		const stop = ctx.slots.subscribe("conversation.chat.node", mount);
		return () => {
			stop();
			unreg?.();
		};
	}), "session-plus user edit");
}
function DeleteButton(props) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
		type: "button",
		className: "sp_mini sp_danger",
		style: {
			background: "#ef4444",
			backgroundColor: "#ef4444",
			borderColor: "#ef4444",
			color: "#fff"
		},
		disabled: props.busy,
		onClick: props.onAsk,
		children: props.t("delete")
	});
}
//#endregion
exports.apply = apply;
exports.inject = inject;

    return module.exports;
  },
});
