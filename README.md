# dsh-session-plus

中文 | [English](README.en.md)

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com) [![推荐 dshfind](https://img.shields.io/badge/%E6%8E%A8%E8%8D%90-dshfind-ffd700?labelColor=555555)](https://dshfind.com/zh/plugins/SZMY-haruhi/dsh-session-plus?ref=badge)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话补全：侧栏归档目录、恢复到原位置、删除、分支对话。

官方其实已经能归档会话，但没有查看、取消归档或删除的界面。我做这个插件，就是把这几项操作补上。全部走公开 slot 和 workspace 域，**不改** `@deepseek-ai` 核心文件，也不往官方「视图选项」菜单里插 DOM。

侧栏最底下、设置旁边点 **归档**。

## 已知失败（请先读）

这不是某一版实现写坏了。我在多个版本里都复现过，社区其它归档类插件也会撞上同一类问题。根因在 DSH 会话日志：`tool` / `result` 必须带 `source.kind = tool` 和 `callId`。工具还在跑的时候把会话归档（中间会 `clear()` / 卸绑定），日志可能被写成非法事件。已经写坏的日志，插件修不回来，只能删掉。

我自己测下来是这样：

| 场景 | 结果 |
| --- | --- |
| **场景一**：这一轮已经结束，再归档，再恢复 | **不会出问题**。重启也还在。 |
| **场景二**：还在长文回答、**没有工具调用**，中途归档，再恢复 | **不会出问题**。回答可以写完。重启也还在。 |
| **场景三**：正在调工具的途中归档，再恢复 | **一定会出问题**。 |
| 删除 | 我没再测到 bug。 |
| 分支对话（修改并分支） | 我测过的路径里没碰到 bug。 |

场景三恢复后，客户端常见：

```
历史加载失败：conversation Context 9:tool-call received more than one start Match（internal）
```

重启服务后再打开，常见：

```
history unavailable
SessionPersistenceCorruptionError: ... message must have tool source（internal）
```

所以：**不要在工具还在跑的时候点归档。** 等这一轮结束，或先点停止。空白「新会话」本来就不能归档。插件会尽量等到空闲（含 `runningCalls` / `partial`，最多约 30 秒）再归档，超时会提示「请先等当前回复结束，或点停止后再归档。」——但我拦不住所有时机。一旦日志已经坏了，恢复没有意义，删掉那个会话即可。

## 特点

- 归档目录：列出官方 `archivedSessionIds`，不是我自己做的影子列表
- 恢复：从归档集合拿掉；工作区 `sessionIds` 槽位官方归档时本来就没拆，所以回到原位置
- 删除：居中二次确认（红色删除），卸工作区记账并删会话日志（含 `.zstd` 兄弟文件、会话目录）；删完不会再取消归档，避免幽灵会话回到列表
- 删的是当前会话时：`sessions.clear()` 回到空白「新会话」，不会 `connectWorkspace`（那个体感像「返回工作区」）
- 空白「新会话」：不能归档、不能删除
- 分支对话：自己消息旁的分叉图标（Y 形带箭头，不是官方 git-branch 那种圆点）→ 就近浮窗改提问，可选填新标题，空则官方 `increaseTitle` 叠 `(1)` `(2)` → `sessions.fork` 再发送；旧会话还在
- 一个入口、一套操作；设置页大管家（导出、暂停、压缩、AI 重命名）我不做

## 行为

| 操作 | 走哪 | 结果 |
| --- | --- | --- |
| 归档 | 官方 `workspaces.archiveSession` | 会话从侧栏分组里消失，记账保留 |
| 恢复 | 写回 workspace 域的 `archivedSessionIds` | 会话出现在原来的工作区位置 |
| 删除 | 卸记账 + 删 persistence 文件 | 不可恢复 |
| 分支对话 | `fork` + `prompt` | 新会话 = 历史前缀 + 改过的提问 + 新回答 |

## 不做

- 不给 `@deepseek-ai` 包打文件补丁
- 不覆盖官方 plugin 行（补丁只有 `insert`）
- 不伪装成官方筛选菜单的一项
- 不修复已经损坏的会话日志（那是宿主 persistence 的事）

## 安装

npm（稳定版，[官方推荐](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)）：

```sh
dsh plugin --profile web add dsh-session-plus
dsh web
```

也可以跟 GitHub（跟仓库最新提交；本包预构建 `lib/`，git 安装无需 `allowBuilds`）：

```sh
dsh plugin --profile web add github:SZMY-haruhi/dsh-session-plus
dsh web
```

钉 commit：

```sh
dsh plugin --profile web add github:SZMY-haruhi/dsh-session-plus#<commit>
```

卸载：

```sh
dsh plugin --profile web remove dsh-session-plus
```

> `dsh.bundle` · 预构建 `lib/` · git 安装无需 `allowBuilds`

## 从源码开发

```sh
pnpm install
pnpm build
dsh plugin --profile web add .
dsh web
```

`pnpm pack` 可打出与 npm 发布相同的 tarball，用 `dsh plugin --profile web add ./dsh-session-plus-0.1.0.tgz` 安装。

## 更新记录

### 0.1.0 · 2026-08-18 · 最初版本

第一次把「会话补全」做成能用的插件。这一版实现了：

- 侧栏底部 **归档** 入口（`sidebar.footer.action`，与官方设置同一套几何）
- 覆盖层归档目录：列出、恢复、删除
- 归档走官方 `workspaces.archiveSession`（只写 `archivedSessionIds`，工作区槽位保留）
- 恢复后回到原来的工作区位置
- 删除：居中确认、卸记账、删 jsonl / `.zstd` / 会话目录；当前会话则清成空白「新会话」
- 空白草稿拒绝归档 / 删除
- 归档、删除前尽量等到空闲，不 `cancel()` 正在跑的一轮
- 用户消息旁 **修改并分支**：就近浮窗、可选新标题、`sessions.fork` + `prompt`
- 只走公开 Harness API，不打 `@deepseek-ai` 补丁，不往视图选项插 DOM

已知限制见上文「已知失败」。场景三是宿主日志约束，不是这一版独有的回归。

## 致谢

实现时我读过这些 MIT 仓库当设计参考。只借鉴思路，没有抄它们的代码；版权仍归原作者：

- [cokiscarazo-rgb/dsh-session-management](https://github.com/cokiscarazo-rgb/dsh-session-management)
- [Moeblack/dsh-message-edit](https://github.com/Moeblack/dsh-message-edit)
- [cindyguyuehu123/dsh-webchatlike](https://github.com/cindyguyuehu123/dsh-webchatlike)（交互模型；本插件不补丁核心包）
- [dylan121322/dsh-session-unarchive](https://github.com/dylan121322/dsh-session-unarchive)（恢复到原槽位这个想法）

没有 LICENSE 的仓库，我不当成可复制源码。公开契约见本仓库 `NOTICE`。

官方契约来自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) / Cordis。

## 许可

[MIT](LICENSE) · Copyright (c) 2026 SZMY-haruhi

---

## Author

<a href="https://tonkatsu258.vercel.app/index.html">
  <img src="docs/avatar.png" width="96" height="96" alt="tonkatsu258" />
</a>

**感谢star❤️**
**[tonkatsu258](https://tonkatsu258.vercel.app/index.html)** · [个人网站](https://tonkatsu258.vercel.app/index.html)
