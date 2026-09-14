# DeepSeek Harness 超级记忆

[English](README.md) | 中文

`0.3.1` 面向官方 Harness `0.1.5-rc.2` / Cordis `4.0.2`，提供按项目隔离、先审核后检索的长期记忆。安装使用固定版本包；[安装与验收指南](INSTALL.md) 包含商店入口、一条命令和 Agent 安装提示。

[![跨平台 Harness 验证](https://github.com/Missher12/dsh-missher-memory/actions/workflows/cross-platform.yml/badge.svg)](https://github.com/Missher12/dsh-missher-memory/actions/workflows/cross-platform.yml)

`dsh-missher-memory` 是可独立安装的 DeepSeek Harness bundle，用于恢复超级长项目的架构、决定、进度、失败经验和下一步。当前包包含索引召回和可逆重复记忆整理；它不修改 Harness 核心，也不复制或改写现有旧记忆数据库。

新电脑使用通用 Cordis 服务时，请阅读 [Cordis 接入指南](CORDIS.md)，加载 `dsh-missher-memory/core`。既有 Harness 用户继续阅读 [Agent 接入指南](AGENT.md)。Core 提供不依赖 Harness 的 `missherMemoryService`；Brain 现在仅影响 Harness 自动召回。

## 安装

前置条件：已安装官方 DeepSeek Harness `0.1.5-rc.2`，`dsh` 在 PATH 中，Node 为 `^22.19.0` 或 `>=24.0.0`。本包按 Cordis `4.0.2` 验证；其他宿主版本需另行验收。无需 Python、原生编译、Brain 或旧记忆数据库；Brain 仅用于可选自动召回。

在 DSH Market 搜索 `dsh-missher-memory`，核对仓库为 `Missher12/dsh-missher-memory`，查看条目的版本后安装。商店条目由独立目录维护；若仍显示 `0.3.0-cordis.0`，请使用下方固定 `0.3.1` 命令。

```sh
dsh plugin --profile web add https://github.com/Missher12/dsh-missher-memory/releases/download/v0.3.1/dsh-missher-memory-0.3.1.tgz
```

[下载 0.3.1 安装包](https://github.com/Missher12/dsh-missher-memory/releases/download/v0.3.1/dsh-missher-memory-0.3.1.tgz)（176873 bytes，SHA-256：`5bde1f688d6791954d890e2b958775abbdaffe06532464c6b23de362cb06ed49`）。离线安装时把命令中的 URL 换成下载文件的路径。

安装后运行 `dsh --profile web --dump-config`，核对 `dsh-missher-memory` 和 `missher-memory` 均存在；随后重启同一 `web` profile 的 Harness。配置存在仅证明安装组合成功，继续在“设置 → 项目记忆”绑定，并实际调用 `memory_search`。

给 Agent 的一句话：

> 请按 https://github.com/Missher12/dsh-missher-memory/blob/main/INSTALL.md 核对宿主版本，在当前 web profile 安装固定 0.3.1 包，协助我在设置的项目记忆页确认绑定，并实际调用 memory_search 验证；保留现有数据。

新安装无需 `vectors.db`；绑定后使用 `$DSH_HOME/missher-memory/state.db`。如需关联已有旧记忆，详见[安装指南](INSTALL.md)，旧来源始终只读。


## 平台支持

Core 是纯 JavaScript，运行时只导入 Node 内建模块；Harness 适配器使用宿主 peer 包。CI 已配置构建一个 canonical `.tgz`，让 macOS Intel、macOS Apple Silicon、Windows x64 和 Linux x64 验证相同字节，包含 Cordis 容器、安装包安全、CLI 安装/卸载和合成数据。CLI 矩阵固定到 DeepSeek Harness Desktop 0.3.6 / Harness 0.1.1-rc.2。已配置矩阵不代表未发布候选版已经通过所有平台，实际证据以本轮交付为准。

在有稳定原生 runner 和已交付 Harness 目标前，不宣称支持 Windows ARM 与 Linux ARM。安装包中不包含平台专属数据库内容或原生 addon。

## 工作方式

- `memory_search` 按当前会话已确认的项目绑定，只读搜索外部记忆和已审核的插件记忆，并显示来源、时间和稳定引用。
- cwd 只用于生成一次绑定候选。持久状态只保存不可逆项目键、basename、短 hash 和加密后的外部 session 标识，不保存绝对 cwd。
- 项目记忆与个人偏好分层。项目搜索不会读取其他项目；个人搜索不会读取外部项目数据库。
- 新绑定项目默认开启候选记忆捕获。用户明确绑定项目后，session 结束时只会生成待审核候选，绝不会自动成为已审核记忆。
- 新绑定项目默认开启自动召回。它把已审核原子、可逆胶囊和可选旧记忆贡献给 Desktop Brain Hub；只有 Brain Hub 会追加一条可见、带来源的召回消息。
- 至少存放七天、未固定且正文完全重复的已审核原子会自动整理；来源只归档不删除，回滚胶囊会逐条恢复来源和 FTS 索引。
- 数据库缺失、损坏、路径不安全或查询超时时，插件返回稳定状态并失败开放，不阻止 Harness 启动和会话。

## 首次绑定

1. 在目标项目目录打开一个顶层会话，让设置页出现 basename 和短 hash 候选。
2. 查看只包含记录数量和时间范围的来源列表，选择确实属于该项目的来源。
3. 确认绑定，或把另一个 worktree 候选链接到已存在项目。
4. 新绑定项目会默认开启“候选记忆捕获”和“自动召回”，两者仍可独立关闭；已有项目设置不会被迁移或覆盖。

旧数据库没有可信 project id，插件不会根据 cwd、相似文本或时间自动归类来源。来源选择错误会把历史归入错误项目；首次绑定前应人工确认。

## 使用搜索

模型或用户可以明确调用：

```text
memory_search({ query: "packaged smoke", scope: "project", limit: 5 })
```

已绑定的新项目应返回 `status: "ready"` 和空 `results`；这证明真实工具可用，不证明已有记忆。返回 `project-unbound` 时先确认绑定；工具不存在时检查 profile 和宿主服务。完整的合成记录审核后检索验收见 [INSTALL.md](INSTALL.md)。

`scope` 可为 `project` 或 `personal`。查询按字面量处理，不接受 FTS 运算符语义；结果受条数和 UTF-8 字节预算限制。搜索不会创建 `state.db`，也不会触发候选捕获。

## 候选审核与召回

捕获开启后，插件只缓冲顶层会话中的直接用户/助手文本，忽略工具输出、插件注入和子代理会话。任何一条消息命中凭据、私钥、连接串、身份证号、金融号码或敏感用户路径时，整段会话不生成候选。

设置页可编辑、合并、批准、固定或遗忘候选。只有批准后的记忆可被搜索或召回；固定只影响排序。项目删除会删除该项目的绑定、设置、候选、项目记忆，以及从该项目候选派生的个人记忆，不触碰外部数据库。

自动召回只使用已审核内容和显式绑定的外部来源。它有独立开关、条数和字节预算；插件错误、超时或状态异常时不贡献任何内容。安装包内置旧记忆只读 Reader 代码，但不包含旧数据库、用户状态、凭据或路径。

## 数据与卸载

插件自有状态位于 `$DSH_HOME/missher-memory/`，主要包括权限受限的 `state.db` 和本机密钥。候选正文和批准正文保存在 `state.db`；项目别名是不可逆摘要，外部 session 标识使用本机密钥加密。`DATA-RETENTION.md` 定义完整保留规则，`SECURITY.md` 定义威胁模型。

卸载前可按需导出项目记忆；要保留重装恢复能力，请不要删除项目数据。卸载命令：

```sh
dsh plugin --profile web remove dsh-missher-memory
dsh --profile web --dump-config
```

卸载只移除 bundle 和 profile patch，默认保留 `$DSH_HOME/missher-memory/`，以便重装恢复。确认不再需要并完成备份后，用户可自行删除该目录；不要删除或移动外部 `vectors.db`。

## 状态说明

- `未连接（可选）`：旧记忆目录或 `vectors.db` 不存在；内置项目记忆仍正常可用，插件不会代建外部库。
- `路径不安全`：目录、数据库或插件状态是符号链接、非普通文件，或路径不满足包含规则。
- `格式不兼容`：外部表/FTS5 结构或插件状态 schema 不受支持。
- `损坏`：SQLite 无法以只读方式验证。
- `超时`：Worker 已终止并会在下一次搜索时重建。

发布前可运行：

```sh
node scripts/verify-package.mjs dist/dsh-missher-memory-0.3.1.tgz
node scripts/native-smoke.mjs --archive dist/dsh-missher-memory-0.3.1.tgz
```

`native-smoke.mjs` 只使用合成数据库；传入 `--cli /absolute/path/to/dsh-cli.js` 时还会在临时 profile 中真实安装、组合并卸载 tarball。

## 2026-09-06 维护候选包

`0.3.0-cordis.0` 为预发布版本。预构建安装包和对应验证结果见 [Release 说明](https://github.com/Missher12/dsh-missher-memory/releases/tag/v0.3.0-cordis.0)；商店是否可搜索还取决于收录条目是否被合并。本次 Cordis 升级已解除必需 Brain 依赖；安装成功仍不代表当前 Agent 已发现并能调用工具。CLI 安装/卸载与真实运行时激活是不同证据。包 smoke 输出 `runtimeMode: cordis-with-synthetic-host-services` 和 `realHostActivationVerified: false`，并使用临时合成数据验证重装恢复，不代表真实 Desktop Brain 或界面验收。

已审核记忆仍是历史数据，不能提供新授权。遗忘清除派生原子和胶囊，但保留 forgotten 候选作为审核历史。项目 JSON 导出暂不包含胶囊和 archived 原子，不是完整备份。
