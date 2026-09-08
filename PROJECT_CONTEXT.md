# Cordis 长期记忆插件项目上下文

## 当前摘要（2026-09-08）

独立仓库 `Missher12/dsh-missher-memory`；本地候选 `0.3.0-cordis.0`，schema 2。用户已授权按 Cordis 方向实现，MCP/CLI/HTTP 方案撤回。Core 与 Harness、Brain 适配已分离；本节取代此前“整个插件必需 Brain”的描述。

工作树为 `.worktrees/memory-maintenance`，分支 `maintenance/memory-audit-20260906`。本轮基线完整 SHA 为 `887f2ca838452b76219827fdf11d4e1e089d73b1`；最终 SHA 与安装包校验和见 `dist/cordis-evidence/source-revision.json` 和 `package-verification.json`。仅本地提交和打包，不 push/tag/Release。

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

真实 Agent 模型调用、Desktop Brain 注入和设置页 UI 尚未验收。Windows/ARM/Linux 本轮未运行原生验收；CI 新增了 Cordis smoke，但未触发远端运行。

## 后续工作

- 明确过期、纠正链和冲突的数据语义后设计增量 schema。
- 完整一致备份与恢复；现有项目 JSON 导出不是完整备份，换机须显式重绑路径。
- forgotten 候选仍保留正文，不宣称彻底擦除。
- 自有 FTS Worker 和相关性评测；searchByteBudget 只计算正文，Brain 的贡献预算另外计算序列化体积。
- 新宿主必须验证服务加载、工具映射和当前 Agent 实际调用，不能靠 MD 或安装成功判断。

接入文档：`CORDIS.md` / `AGENT.md`。此前五项 Bug 修复记录见 `docs/maintenance-audit-2026-09-06.zh.md`；Cordis 方案与阶段划分见 `docs/portable-agent-proposal-2026-09-08.zh.md`。交接见 `HANDOVER.md`。
