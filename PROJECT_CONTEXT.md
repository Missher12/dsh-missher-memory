# Cordis 长期记忆插件项目上下文

## 分发准备（2026-09-14）

独立 `codex/distribution-20260914` 从冻结源码 `a31b6dd4c97a1793910c10a88d4304787dcecd4d` 准备 `0.3.1` 公开安装材料。只改 README 中英、Agent 接入说明和新增 INSTALL.md，修正实际设置入口为 Project Memory / 项目记忆；安装包保持原始 176873 bytes / SHA-256 `5bde1f688d6791954d890e2b958775abbdaffe06532464c6b23de362cb06ed49`，不重打同名包。

原工作树的 0.3.2 和未提交文档保持原样。此次不包含 Workbench 消费者，不构建 Desktop，不调用真实模型或读取用户记忆。既有 Host 默认生命周期证据按运行时字节一致关系复用；本次只核对冻结包、客户端贡献入口和公开文档。GitHub 发布与商店条目更新由总指挥统一处理，未执行任何远端写入。


## 0.3.1 正式交付候选身份

本轮正式目标由总指挥指定为 0.3.1；当前仍仅本地候选，未推送、tag 或发布。已公开的 0.3.0-cordis.0（8a8c796b75f08995b7af7a49be9e0c5a5bc08fd4）与 S2/R7 同名内部候选分别保留，不覆盖或复用旧发布资产。

从 ee9142d791e324ab0f77007de9186f4018b88251 只更新版本、当前安装说明和验证输出路径。运行时与默认能力不变；按包内 lib 文件逐字节对应关系沿用既有 19 项和 12 次 loopback 证据。新增版本/manifest 对应与严格声明消费检查，证据在 dist/release-0.3.1；最终桌面组合仍由总指挥真实消费。

## 当前摘要（2026-09-13 R7）

在 S2 提交 `1f0a5b7b362a062d991fefa59782b4870fc2e854` 上补齐默认能力验证。产品运行时代码、schema 和开关默认值未改：官方 Profile 中默认捕获、审核门槛、30 秒首次自动维护、卸载重装恢复均通过；现有 Brain 可选装载/移除/恢复时，召回的日志与 loopback 模型请求一致、每轮无重复且跨项目隔离。无 Brain 的原版宿主不提供自动召回。

验收使用官方 npm 精确包 0.1.5-rc.2 / Cordis 4.0.2，以及 Desktop `d1e8bd9c6d49f980405888099087f931ddd26d83` 的现有 Brain 五文件只读测试快照。没有新增 Hub 或分发 Brain；已停用的真实 Brain 状态未改。12 次模型协议请求均到 127.0.0.1，没有真实账户请求。实际环境仍为 Intel macOS / Node 25.6.0；最终桌面组合、其他平台与真实 UI 待相应负责人验收。

本轮源码/包哈希及命令见 `dist/r7/source-revision.json`，默认 smoke 见 `dist/r7/defaults-smoke.json`，Brain 来源见 `dist/r7/brain-fixture/provenance.json`。版本仍为未发布本地候选 0.3.0-cordis.0，必须按哈希区分。未推送或发布。

## 2026-09-12 S2 历史摘要

本轮只负责官方 Harness 0.1.5-rc.2 / Cordis 4.0.2 的绑定、审核、持久化、手动检索和卸载重装切片。独立工作树 `.worktrees/official-compat-20260912`，分支 `codex/memory-official-compat-20260912`，起点 `782617f5c5b4354677e7a49cf9a85665307ce104`。旧根和旧维护工作树保持不变。本轮没有推送、tag、发布或替换真实安装的授权。

Client 改用官方 Cordis Context 和 ui-renderer slots 服务，依赖锁定目标官方版本。Core、数据库 schema 与默认捕获/召回/整理设置不变。包版本暂保留 0.3.0-cordis.0，仅交付本地候选；必须用本轮 `dist/s2/source-revision.json` 的 SHA/包哈希辨认，不能拿旧 Release 代替。

本轮通过定向测试、类型检查、构建、包校验和真实官方 Profile 的三阶段合成验收。实际为 Intel macOS、Node 25.6.0；没有模型请求、Desktop UI 或自动召回验收，没有运行 Desktop 全构建或平台 CI。具体命令、结果与来源在 `dist/s2/`，实现说明见 `docs/official-compat-2026-09-12.zh.md`。

## 2026-09-08 历史实现与发布摘要

独立仓库 `Missher12/dsh-missher-memory`；Cordis 预发布版本 `0.3.0-cordis.0`，schema 2。用户已授权按 Cordis 方向实现，MCP/CLI/HTTP 方案撤回。Core 与 Harness、Brain 适配已分离；本节取代此前“整个插件必需 Brain”的描述。

工作树为 `.worktrees/memory-maintenance`，分支 `maintenance/memory-audit-20260906`。本轮基线完整 SHA 为 `887f2ca838452b76219827fdf11d4e1e089d73b1`；实现阶段证据在 `dist/cordis-evidence/`，发布证据在 `dist/store-release/`，两者包哈希不同，以 Release 附件为分发依据。2026-09-08 用户明确授权“上”架：允许发布该预发布版本并提交商店收录 PR。发布目标为 `v0.3.0-cordis.0`，商店使用固定 Release tarball；收录须经上游维护者合并，不以 PR 已提交代替上架。发布状态以 GitHub Release、收录 PR 和在线 plugins.json 为准，发布验收证据保存在 `dist/store-release/`。

## 目标与边界

在兼容的 Cordis 宿主中保存、查找和恢复按项目隔离的已审核记忆，降低跨会话重复解释。保留已有 Harness 安装方式、设置页和数据。Memory 负责事实记忆，Evolution 负责规则晋升。

Core 不自动读取其他 Agent 的会话；宿主负责把可信项目上下文映射到工具。记忆文本不构成系统指令、用户授权或写入批准。不承诺非 Cordis Agent 直接安装。

## 架构和入口

- `src/core.ts` / 包子入口 `dsh-missher-memory/core`：仅使用结构化 Cordis context，提供 `missherMemoryService`；运行时无 Harness/Cordis npm 包 import。
- `src/host/memory-service.ts`：项目 facade 的 status/search/get/propose，可信操作者 bind/admin，服务内队列和关闭流程。
- `src/index.ts`：保留 Bundle 默认入口，用 `dshHomePath` 组合 Core 与 Harness adapter。
- `src/host/harness-adapter.ts`：等 Core/tools，注册原来的 memory_search、session 捕获、RPC、设置页后端与整理调度。
- `src/host/brain-adapter.ts`：单独等待 Brain，注册/注销 provider；Brain 缺失不影响手动搜索。
- `src/host/project-search.ts`：通用服务与 Harness 工具共享检索逻辑；已绑定但无旧来源/无匹配内容时返回 ready 空结果。
- `src/host/state-store.ts`：schema 2、自有 FTS、候选/审核/胶囊；新增定向来源读取，审核/遗忘可在事务内核验项目。
- `src/workers/`：可终止的外部 SQLite 只读 Worker。自有 SQLite 查询尚未迁入 Worker。
- `src/client/`、`src/remote.ts`：保留 Harness 设置页与 RPC；已有 `missherMemory` 名称仍归 RPC，不与新服务冲突。

## 数据与安全不变量

1. Core 只用操作者显式配置的绝对 stateDirectory。Harness 沿用 `$DSH_HOME/missher-memory/`，不会自动发现、复制或迁移真实记忆。
2. 空状态加载、诊断、检索及未绑定 propose 不产生状态文件。明确绑定后才初始化；已有状态的 schema/FTS 维护可能写盘。
3. 项目 cwd 来自可信宿主；每个 facade 固定上下文。跨项目 get/approve/forget 拒绝；个人偏好访问在 Core 中默认关闭。
4. propose 仅创建 pending；admin 不能直接映射成模型自批工具。完全相同的项目、sourceId 和标准化内容去重，重试不复活已遗忘记录。
5. key.bin 完整写入后原子发布，避免并发读到半个密钥。初始化/迁移由 SQLite 事务串行化，审核状态检查与写入处于同一事务。
6. sources、时间、lifecycle 和引用可追踪。归档来源可显式 get，但不进入默认搜索；隐私过滤和体积限制继续生效。
7. 外部 vectors.db 始终可选、只读，不作为测试素材。所有测试使用临时合成数据和隔离状态。
8. 卸载释放资源并保留状态；旧 Core facade 拒绝新调用。错误失败开放，不授权自动修复、删除或绕过 Brain 注入。

## 本轮验证与限制

当前回归为 29 文件 / 121 测试通过，并通过 typecheck/build。包在临时目录无 Harness 依赖导入，两种真实 Cordis 容器均完成生命周期；四个独立进程只产生一次审核。原版 Harness CLI 0.1.1-rc.2 完成临时安装、配置组合、卸载、重装和合成数据恢复。最终日志归档在 `dist/cordis-evidence/`。

已实测 darwin-x64，Node 25.6.0；包 Core 另在 Node 22.19.0 验证。运行时版本为上游 cordis 4.0.0-rc.9 与 @deepseek-ai/cordis 4.0.1。上游 rc.9 类型声明的无扩展名 re-export 与 TS NodeNext 不兼容；JS 运行时与 Core 独立类型入口分别核验。

真实 Agent 模型调用、Desktop Brain 注入和设置页 UI 尚未验收。发布阶段已通过 macOS Intel、macOS Apple Silicon、Windows x64、Linux x64 四个平台 CI 的 121 项测试、类型检查、独立 Cordis 与 Harness CLI 安装生命周期验收。四个平台使用相同的 canonical 包。CI 使用 runner 临时 DSH_HOME 和合成数据；这仍不等于真实 Agent 模型或 Desktop UI 验收。

## 后续工作

- 明确过期、纠正链和冲突的数据语义后设计增量 schema。
- 完整一致备份与恢复；现有项目 JSON 导出不是完整备份，换机须显式重绑路径。
- forgotten 候选仍保留正文，不宣称彻底擦除。
- 自有 FTS Worker 和相关性评测；searchByteBudget 只计算正文，Brain 的贡献预算另外计算序列化体积。
- 新宿主必须验证服务加载、工具映射和当前 Agent 实际调用，不能靠 MD 或安装成功判断。

接入文档：`CORDIS.md` / `AGENT.md`。此前五项 Bug 修复记录见 `docs/maintenance-audit-2026-09-06.zh.md`；Cordis 方案与阶段划分见 `docs/portable-agent-proposal-2026-09-08.zh.md`。交接见 `HANDOVER.md`。

## 已发布与商店提交（2026-09-08）

- GitHub prerelease：[`v0.3.0-cordis.0`](https://github.com/Missher12/dsh-missher-memory/releases/tag/v0.3.0-cordis.0)。
- 发布源码 SHA：`8a8c796b75f08995b7af7a49be9e0c5a5bc08fd4`。之后仅交接文档提交不改变此 tag 或已验证安装包。
- 包：177387 bytes；SHA-256 `6b1a8a4fe4b5e90e94e9c6ef3406fa1347551efee45a8c352d5e0b57d810d886`。包、checksum、release-verification.json 三个附件均已匿名下载并逐字节匹配。
- [CI run 34241169065](https://github.com/Missher12/dsh-missher-memory/actions/runs/34241169065)：五个 job 全部 success，四个平台验收证据已归档。
- [商店收录 PR #4671](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/4671)：只新增本插件 YAML；提交时 OPEN，等待上游审核/合并。在线 plugins.json 当时仍无该条目，不能宣称已经可搜索。

商店检查补充（2026-09-08）：PR #4671 的 Submission gate 已通过；PR check 在整站构建阶段被上游三个 wwweljf/dsh-plugins 条目的 `no added-date derivable` 错误阻断。未修改这些其他插件条目；已在 PR 正文附上 run 34242256495 和错误证据，等待上游修复与维护者审核。此阻断不影响已发布包的四平台验收。
