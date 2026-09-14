# Install dsh-missher-memory 0.3.1

English instructions follow the Chinese instructions. This guide describes the fixed 0.3.1 release; verify the exact asset and checksum before installing.

## 中文

### 前置条件与安装

使用已安装的官方 DeepSeek Harness `0.1.5-rc.2` / Cordis `4.0.2`，Node `^22.19.0` 或 `>=24.0.0`；终端应能运行 `dsh`。Host 需要 `tools`、`dshHomePath`，Web 需要官方设置页、locale、renderer 和 remote 服务。插件不是独立应用或 MCP Server。Brain 不是安装或手动检索前提，仅提供可选自动召回。

在 DSH Market 搜索 `dsh-missher-memory`，核对仓库 `Missher12/dsh-missher-memory` 和条目版本后安装。目录更新独立于 GitHub Release；若商店仍列出 `0.3.0-cordis.0`，用固定版本命令安装 `0.3.1`：

```sh
dsh plugin --profile web add https://github.com/Missher12/dsh-missher-memory/releases/download/v0.3.1/dsh-missher-memory-0.3.1.tgz
```

[下载包](https://github.com/Missher12/dsh-missher-memory/releases/download/v0.3.1/dsh-missher-memory-0.3.1.tgz)：176873 bytes；SHA-256 为 `5bde1f688d6791954d890e2b958775abbdaffe06532464c6b23de362cb06ed49`。离线时把命令中的 URL 换成下载文件路径。始终使用与运行中 Host 相同的 `DSH_HOME` 和 profile。

```sh
dsh --profile web --dump-config
```

核对配置包含 `dsh-missher-memory` 和 `missher-memory`。退出并重新启动同一 `web` profile 的 Harness。配置出现插件只证明组合成功，还需完成以下步骤。

### 设置、绑定与实际检索

1. 在专用测试项目打开带工作目录的顶层 Harness 会话。进入“设置 → 项目记忆”。
2. 核对“当前目录候选”的目录名和短 hash；点击“确认绑定项目”。新电脑没有旧来源时可直接绑定，无需 `vectors.db`。关联 worktree 时选择已存在的对应项目。
3. 只有确实需要旧记忆时才选择属于该项目的来源。插件不自动推断来源归属；确认需要用户审阅。
4. 确认当前 Agent 的工具列表包含 `memory_search`，实际调用下方参数。已绑定的空项目应返回 `status: "ready"`、空 `results` 和当前项目标识。

```text
memory_search({"query":"memory-install-check","scope":"project","limit":5})
```

`project-unbound` 表示需完成绑定；`caller-required` 表示会话没有工作目录；工具缺失或设置页缺失表示宿主加载尚未通过。不得用配置 dump 代替这次调用。

需要验证保存与检索时，在同一测试项目的顶层会话留下无敏感信息的架构或决定，例如“决定：memory-install-check 测试项目使用本地缓存”。正常结束会话，让宿主释放该 session；打开新会话，在项目记忆页刷新并审阅候选。待审核内容应无法检索，点击“审核通过”后再次调用 `memory_search`，确认结果包含该内容及 `source`、`recordedAt`、`reference`。另一个独立绑定项目的同样查询不应返回此记录。不要为此复制真实记忆、凭据或数据库。

捕获和维护不需要 Brain。自动召回开关开启不代表宿主提供了 Brain；无 Brain 时使用显式 `memory_search`。这些步骤是安装验收说明，本指南本身不会执行工具或自动批准记忆。

### 可选旧记忆与卸载

旧版 `vectors.db` 只作为可选只读来源。默认目录为 `$HOME/.local/share/missher-memory/tencentdb/`；如需其他位置，在启动 Harness 前把 `MISSHER_TENCENTDB_DIR` 设置为包含该数据库的现有绝对目录。不要创建空数据库；插件拒绝符号链接和逃逸路径。

```sh
dsh plugin --profile web remove dsh-missher-memory
```

重启同一 profile 后，插件工具和设置页应移除。卸载保留 `$DSH_HOME/missher-memory/`；保持同一目录重装可恢复绑定与记忆。不要为卸载删除项目或数据目录。项目 JSON 导出不含所有胶囊和归档内容，不是完整备份；需要备份时先停止 Host，再复制整个插件数据目录（含本机密钥）。

给 Agent 的一句话：

> 请按 https://github.com/Missher12/dsh-missher-memory/blob/main/INSTALL.md 核对宿主版本，在当前 web profile 安装固定 0.3.1 包，协助我在设置的项目记忆页确认绑定，并实际调用 memory_search 验证；保留现有数据。

## English

### Prerequisites and installation

Use official DeepSeek Harness `0.1.5-rc.2` / Cordis `4.0.2`, Node `^22.19.0` or `>=24.0.0`, and `dsh` on PATH. The Host must provide `tools` and `dshHomePath`; Web needs the official settings, locale, renderer, and remote services. This bundle is not a standalone application or MCP server. Brain is optional and only supplies automatic recall.

Search DSH Market for `dsh-missher-memory`, confirm repository `Missher12/dsh-missher-memory`, and inspect the listed version. Catalog updates are separate from releases. If the catalog still lists `0.3.0-cordis.0`, install the fixed `0.3.1` package:

```sh
dsh plugin --profile web add https://github.com/Missher12/dsh-missher-memory/releases/download/v0.3.1/dsh-missher-memory-0.3.1.tgz
```

The [download](https://github.com/Missher12/dsh-missher-memory/releases/download/v0.3.1/dsh-missher-memory-0.3.1.tgz) is 176873 bytes, SHA-256 `5bde1f688d6791954d890e2b958775abbdaffe06532464c6b23de362cb06ed49`. For offline installation, replace the URL with the downloaded file path. Use the same `DSH_HOME` and profile as the running Host.

Run `dsh --profile web --dump-config`, confirm `dsh-missher-memory` and `missher-memory`, and restart Harness with the same `web` profile. Continue with runtime acceptance below.

### Binding and an actual tool call

1. Open a top-level Harness session with a working directory in a dedicated test project, then Settings → Project Memory.
2. Inspect the current directory basename and short hash, then choose Confirm project binding. A fresh installation needs no legacy source or `vectors.db`. Link a worktree to the corresponding existing project when appropriate.
3. Select legacy sources only if you need them and have reviewed their project ownership.
4. Confirm `memory_search` exists in the current Agent tool list and actually call it:

```text
memory_search({"query":"memory-install-check","scope":"project","limit":5})
```

A freshly bound project returns `status: "ready"`, empty `results`, and the current project identity. `project-unbound` requires binding; `caller-required` requires a session working directory. An absent tool or settings page means runtime loading is not verified.

To test persistence, leave a synthetic decision such as “Decision: the memory-install-check test project uses a local cache” in a top-level session. End the session normally so the Host disposes it, open a new session, refresh Project Memory, and inspect the pending candidate. Search must not return it before approval. Select Approve, repeat the search, and confirm the text with `source`, `recordedAt`, and `reference`. The same query in another independently bound project must not return that record. Use no real memory or credentials as fixtures.

Capture and maintenance work without Brain. An enabled recall switch does not prove Brain exists; use explicit `memory_search` when Brain is absent. These are acceptance instructions, not claims that this guide has executed a tool or approved a candidate.

### Legacy memory and uninstall

An existing `vectors.db` is optional and read-only. The default directory is `$HOME/.local/share/missher-memory/tencentdb/`. To use another existing directory, set `MISSHER_TENCENTDB_DIR` before starting Harness. Do not create an empty database. Links and escaping paths are rejected.

```sh
dsh plugin --profile web remove dsh-missher-memory
```

Restart the same profile; the plugin tool and settings page should disappear. Uninstall preserves `$DSH_HOME/missher-memory/`. Reinstall using the same directory to recover bindings and memory. Do not delete project data for a normal uninstall. Project JSON export is not a full backup; stop the Host before copying the complete plugin data directory, including its local key.

One sentence for your Agent:

> Follow https://github.com/Missher12/dsh-missher-memory/blob/main/INSTALL.md to check host compatibility, install the fixed 0.3.1 package in the current web profile, help me confirm the project binding in Settings → Project Memory, and call memory_search to verify activation while preserving existing data.

## Package identity and evidence

The frozen package was built from `a31b6dd4c97a1793910c10a88d4304787dcecd4d`. Repository setup documentation was corrected afterward; its bytes are not substituted into the frozen tarball. The package's runtime, declarations, and bundle patch are unchanged from the verified default lifecycle candidate. Existing evidence covers official Host activation, default capture, review-before-search, optional Brain loopback recall, project isolation, maintenance, and uninstall/reinstall recovery using synthetic data on Intel macOS. It does not establish real model quality, actual Desktop UI acceptance, or fresh native acceptance on other platforms for 0.3.1.
