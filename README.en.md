# dsh-session-plus

[中文](README.md) | English

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![Recommend dshfind](https://img.shields.io/badge/Recommend-dshfind-ffd700?labelColor=555555)](https://dshfind.com/zh/plugins/SZMY-haruhi/dsh-session-plus?ref=badge)

Session completion for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): sidebar archive directory, restore to the original workspace slot, delete, and branch conversation.

Stock DSH can already archive a session, but it has no UI to list, unarchive, or delete. I built this plugin to fill those operations. Everything goes through public slots and the workspace domain. It does **not** patch `@deepseek-ai` packages, and it does not inject DOM into the native View options menu.

Open **Archive** next to Settings at the bottom of the sidebar.

## Known failure (read this first)

This is not a one-version regression. I reproduced it across multiple builds of this plugin, and other community archive plugins hit the same class of bug. The root cause is DSH session persistence: `tool` / `result` events must carry `source.kind = tool` and a `callId`. Archiving while a tool call is still in flight (the host will `clear()` / unbind) can write an illegal event. A log that is already corrupt cannot be repaired by this plugin — delete it.

What I actually tested:

| Scene | Result |
| --- | --- |
| **Scene 1**: archive after the turn has finished, then restore | **Does not fail.** Survives a restart. |
| **Scene 2**: archive mid-answer on a long write with **no tools**, then restore | **Does not fail.** The answer can finish. Survives a restart. |
| **Scene 3**: archive **while a tool call is in progress**, then restore | **Always fails.** |
| Delete | I have not found remaining bugs. |
| Branch conversation (Edit and branch) | I did not hit a bug on the paths I tried. |

After Scene 3, the client commonly shows:

```
历史加载失败：conversation Context 9:tool-call received more than one start Match（internal）
```

After a server restart:

```
history unavailable
SessionPersistenceCorruptionError: ... message must have tool source（internal）
```

So: **do not archive while a tool is still running.** Wait for the turn to finish, or stop it first. A blank “New session” cannot be archived anyway. The plugin tries to wait until idle (including `runningCalls` / `partial`, up to about 30 seconds) before archive; on timeout it tells you to wait or stop. That does not cover every timing. If the log is already broken, restore is useless — just delete that session.

## Features

- Archive directory: the official `archivedSessionIds` set, not a shadow list I invented
- Restore: drop the id from that set; workspace `sessionIds` accounting is kept on archive, so the session returns to its original slot
- Delete: centered confirm (red delete), detach workspace accounting, remove the session log (including the `.zstd` sibling and the session directory); do not unarchive after rm, so the card cannot ghost back into the list
- If the deleted session is the current one: `sessions.clear()` to a blank New session — not `connectWorkspace` (that felt like “return to workspace”)
- Blank New session: no archive, no delete
- Branch conversation: Y-fork-with-arrows icon beside your message (not the official git-branch dots) → nearby popover to edit the prompt, optional new title, empty falls back to official `increaseTitle` `(1)` `(2)` → `sessions.fork` then send; the old session stays
- One entry, one operation surface; I am not building a settings-page session OS (export, pause, compaction, AI rename)

## Behavior

| Action | Path | Result |
| --- | --- | --- |
| Archive | official `workspaces.archiveSession` | hidden from grouping; accounting kept |
| Restore | write workspace-domain `archivedSessionIds` | back in the original workspace slot |
| Delete | detach + delete persistence file | irreversible |
| Branch conversation | `fork` + `prompt` | new session = prefix + edited prompt + new answer |

## Out of scope

- No file patches on `@deepseek-ai` packages
- No override of official plugin rows (the patch is insert-only)
- No injection into the native View options menu
- No repair of already-corrupt session logs (that belongs to host persistence)

## Install

npm (stable, [official recommendation](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)):

```sh
dsh plugin --profile web add dsh-session-plus
dsh web
```

Or follow GitHub (latest commit; this package ships prebuilt `lib/`, so git install does not need `allowBuilds`):

```sh
dsh plugin --profile web add github:SZMY-haruhi/dsh-session-plus
dsh web
```

Pin a commit:

```sh
dsh plugin --profile web add github:SZMY-haruhi/dsh-session-plus#<commit>
```

Remove:

```sh
dsh plugin --profile web remove dsh-session-plus
```

> `dsh.bundle` · prebuilt `lib/` · git install does not need `allowBuilds`

## Develop from source

```sh
pnpm install
pnpm build
dsh plugin --profile web add .
dsh web
```

`pnpm pack` builds the same tarball npm would publish. Install with `dsh plugin --profile web add ./dsh-session-plus-0.1.0.tgz`.

## Changelog

### 0.1.0 · 2026-08-18 · first release

This is the first working cut of “session completion.” This version ships:

- Sidebar footer **Archive** (`sidebar.footer.action`, same geometry as official Settings)
- Overlay archive directory: list, restore, delete
- Archive via official `workspaces.archiveSession` (writes `archivedSessionIds` only; workspace slot kept)
- Restore returns the session to its original workspace slot
- Delete: centered confirm, detach accounting, remove jsonl / `.zstd` / session directory; current session clears to a blank New session
- Blank drafts refuse archive / delete
- Wait until idle before archive or delete; do not `cancel()` the in-flight turn
- **Edit and branch** on user messages: nearby popover, optional title, `sessions.fork` + `prompt`
- Public Harness APIs only — no `@deepseek-ai` patches, no View-options DOM injection

See “Known failure” above. Scene 3 is a host log constraint, not a regression unique to this cut.

## Acknowledgements

I read these MIT repositories as design references. Ideas only; I did not copy their code. Copyright remains with their authors:

- [cokiscarazo-rgb/dsh-session-management](https://github.com/cokiscarazo-rgb/dsh-session-management)
- [Moeblack/dsh-message-edit](https://github.com/Moeblack/dsh-message-edit)
- [cindyguyuehu123/dsh-webchatlike](https://github.com/cindyguyuehu123/dsh-webchatlike) (interaction model; this plugin does not patch core packages)
- [dylan121322/dsh-session-unarchive](https://github.com/dylan121322/dsh-session-unarchive) (restore-to-original-slot idea)

I do not treat repositories without a LICENSE as copyable source. Public contracts are listed in `NOTICE`.

Official contracts come from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) / Cordis.

## License

[MIT](LICENSE) · Copyright (c) 2026 SZMY-haruhi

---

## Author

<a href="https://tonkatsu258.vercel.app/index.html">
  <img src="docs/avatar.png" width="96" height="96" alt="tonkatsu258" />
</a>

**Thanks for the star ❤️**
**[tonkatsu258](https://tonkatsu258.vercel.app/index.html)** · [personal site](https://tonkatsu258.vercel.app/index.html)
