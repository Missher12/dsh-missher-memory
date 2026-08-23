# DeepSeek Harness 超级记忆

[English](README.md) | 中文

[![跨平台 Harness 验证](https://github.com/Missher12/dsh-missher-memory/actions/workflows/cross-platform.yml/badge.svg)](https://github.com/Missher12/dsh-missher-memory/actions/workflows/cross-platform.yml)

`dsh-missher-memory` 是可独立安装的 DeepSeek Harness bundle，用于恢复超级长项目的架构、决定、进度、失败经验和下一步。它不修改 Harness 核心，也不复制或改写现有 `vectors.db`。

## 平台支持

bundle 运行时是纯 JavaScript，只使用 Node 内建能力。CI 只构建并验证一个 canonical `.tgz`，再让 macOS Intel、macOS Apple Silicon、Windows x64 和 Linux x64 通过固定的 Harness CLI 安装完全相同的字节。必需检查包括单元测试、类型检查、安装包安全、真实 CLI 安装/卸载和合成数据库生命周期。矩阵固定到 DeepSeek Harness Desktop 0.3.5 / Harness 0.1.1-rc.2，以保证结果可复现。

在有稳定原生 runner 和已交付 Harness 目标前，不宣称支持 Windows ARM 与 Linux ARM。安装包中不包含平台专属数据库内容或原生 addon。

## 工作方式

- `memory_search` 按当前会话已确认的项目绑定，只读搜索外部记忆和已审核的插件记忆，并显示来源、时间和稳定引用。
- cwd 只用于生成一次绑定候选。持久状态只保存不可逆项目键、basename、短 hash 和加密后的外部 session 标识，不保存绝对 cwd。
- 项目记忆与个人偏好分层。项目搜索不会读取其他项目；个人搜索不会读取外部项目数据库。
- 新绑定项目默认开启候选记忆捕获。用户明确绑定项目后，session 结束时只会生成待审核候选，绝不会自动成为已审核记忆。
- 新绑定项目默认开启自动召回。它只在顶层用户轮次注入已审核内容，最多 5 条、6000 字节，并附来源、时间和“不可信历史内容”提示。
- 数据库缺失、损坏、路径不安全或查询超时时，插件返回稳定状态并失败开放，不阻止 Harness 启动和会话。

## 安装

需要 DeepSeek Harness 0.1.x Host（Node `^22.19.0` 或 `>=24`）。使用交付的 tarball，不需要 Python、shell 脚本或原生依赖构建：

```sh
dsh plugin --profile web add /absolute/path/dsh-missher-memory-0.1.1.tgz
dsh --profile web --dump-config
```

配置中同时出现 `dsh-missher-memory` 和 `missher-memory` 即表示 bundle patch 已进入 profile。重启 Harness 后，在“设置 → 超级记忆”完成首次绑定。

如果外部数据库不在默认的 `$HOME/.local/share/missher-memory/tencentdb/vectors.db`，启动 Harness 前把 `MISSHER_TENCENTDB_DIR` 设为包含 `vectors.db` 的现有绝对目录。插件不会创建缺失目录或空数据库，也拒绝符号链接和逃逸路径。

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

`scope` 可为 `project` 或 `personal`。查询按字面量处理，不接受 FTS 运算符语义；结果受条数和 UTF-8 字节预算限制。搜索不会创建 `state.db`，也不会触发候选捕获。

## 候选审核与召回

捕获开启后，插件只缓冲顶层会话中的直接用户/助手文本，忽略工具输出、插件注入和子代理会话。任何一条消息命中凭据、私钥、连接串、身份证号、金融号码或敏感用户路径时，整段会话不生成候选。

设置页可编辑、合并、批准、固定或遗忘候选。只有批准后的记忆可被搜索或召回；固定只影响排序。项目删除会删除该项目的绑定、设置、候选、项目记忆，以及从该项目候选派生的个人记忆，不触碰外部数据库。

自动召回只使用已审核内容和显式绑定的外部来源。它有独立开关、条数和字节预算；插件错误、超时或状态异常时不注入任何内容。

## 数据与卸载

插件自有状态位于 `$DSH_HOME/missher-memory/`，主要包括权限受限的 `state.db` 和本机密钥。候选正文和批准正文保存在 `state.db`；项目别名是不可逆摘要，外部 session 标识使用本机密钥加密。`DATA-RETENTION.md` 定义完整保留规则，`SECURITY.md` 定义威胁模型。

先在设置页导出或删除需要处理的项目，再卸载：

```sh
dsh plugin --profile web remove dsh-missher-memory
dsh --profile web --dump-config
```

卸载只移除 bundle 和 profile patch，默认保留 `$DSH_HOME/missher-memory/`，以便重装恢复。确认不再需要并完成备份后，用户可自行删除该目录；不要删除或移动外部 `vectors.db`。

## 状态说明

- `未配置`：目标目录或 `vectors.db` 不存在；插件不会代建。
- `路径不安全`：目录、数据库或插件状态是符号链接、非普通文件，或路径不满足包含规则。
- `格式不兼容`：外部表/FTS5 结构或插件状态 schema 不受支持。
- `损坏`：SQLite 无法以只读方式验证。
- `超时`：Worker 已终止并会在下一次搜索时重建。

发布前可运行：

```sh
node scripts/verify-package.mjs dist/dsh-missher-memory-0.1.1.tgz
node scripts/native-smoke.mjs --archive dist/dsh-missher-memory-0.1.1.tgz
```

`native-smoke.mjs` 只使用合成数据库；传入 `--cli /absolute/path/to/dsh-cli.js` 时还会在临时 profile 中真实安装、组合并卸载 tarball。
