# Cordis 通用记忆插件升级提案

状态：用户已授权实施，基础 Cordis 解耦已在 `0.3.0-cordis.0` 完成。先前 MCP/CLI 主方案已撤回，本轮不新增 MCP、HTTP 或独立 CLI。下文保留设计依据；实际接口以 `CORDIS.md` 为准，进度与证据以 `PROJECT_CONTEXT.md` / `HANDOVER.md` 为准。

实施差异：新服务名为 `missherMemoryService`，因为 `missherMemory` 已被现有 Harness RPC 占用；保留原 RPC 以兼容界面。Core 独立入口、两种 Cordis 容器、可选 Brain、项目 facade、候选审核、来源 get 和并发保护已完成。完整备份、过期/纠正、FTS Worker 为后续阶段。

## 目标与基线

保留独立仓库 `Missher12/dsh-missher-memory`，做可复用的 Cordis 记忆服务插件；Harness 使用适配插件获得工具、会话捕获、设置页和 Brain 召回。

- 分支：`maintenance/memory-audit-20260906`。
- 工作树：`.worktrees/memory-maintenance`。
- 基线 SHA：`887f2ca838452b76219827fdf11d4e1e089d73b1`。
- 设计基线版本：`0.2.1-maintenance.0`，schema 2。
- 当前 Cordis 依赖实测为 `@deepseek-ai/cordis@4.0.1`，其 package manifest 指向 Harness 仓库的 `vendor/cordis`。不能把这项验证当成上游 `cordis` npm 包兼容证据。
- 只修改本插件，不修改 Desktop/Evolution，不推送、打 tag 或发布。

## 实际问题

**问题：已有 Cordis 形式，但还没有通用 Cordis 服务边界。原因：** `src/index.ts` 同时初始化存储、工具、RPC、session 捕获和 Brain，必需注入 `tools`、`dshHomePath`、`missherBrain`。**影响：** 普通 Cordis 容器缺少 Harness 服务时，整个插件不会激活。**推荐方案：** 把核心服务与宿主适配作为独立 Cordis 插件注册，用服务依赖管理生命周期。

**问题：Cordis 不等于所有 Agent 的通用安装协议。原因：** Agent 宿主必须支持加载兼容的 Cordis 插件，并把服务方法接到自己的工具和会话接口。**影响：** 核心服务注册成功不表示模型已经能调用。**推荐方案：** 声明兼容的 Cordis 宿主范围，提供最小宿主适配示例；验收分别覆盖服务可用、工具注册和当前 Agent 实际调用。非 Cordis 宿主不属于直接安装承诺。

## 推荐结构

同一仓库和包保留现有 Harness Bundle 入口，增加可单独加载的核心子入口。下列名称是拟议接口，不是现有导出。

| 插件层 | 提供的能力 | 必需依赖 |
| --- | --- | --- |
| Core | `ctx.missherMemory`：项目绑定、搜索、候选、审核、来源、保留数据 | 兼容 Cordis 运行时、明确的数据目录配置 |
| Harness adapter | `memory_search`、session 捕获、RPC 与设置页适配 | Core + 对应 Harness 服务 |
| Brain adapter | 向 Brain 贡献有预算和来源的已审核记忆 | Core + `missherBrain` |

Core 不导入 Harness session/tools、Desktop UI 或 Brain 运行时代码；它的存储目录由可信配置传入。Harness adapter 继续从现有 `dshHomePath('missher-memory')` 解析路径，保持旧数据位置。复用 StateStore、查询、候选与隐私策略，不复制数据库逻辑。

Bundle 负责组合适配器。Core 可在没有 Harness 服务的 Cordis 容器中工作；没有 Brain 时，Harness 手动检索仍能注册，仅自动召回不可用。不得创建绕过 Brain 的提示注入路径。服务移除、热重载及重新出现时，关联插件按生命周期释放或重建，不重复注册工具、定时器和 Worker。

## 服务与 Agent 接入契约

服务拟提供 status、search、get、propose，以及仅供可信管理界面使用的 bind/review/forget 等管理方法；数据结构在实施前锁定。不要将整个服务对象自动暴露成模型工具。

- 每个请求关联由宿主确认的项目上下文；模型传入的项目 ID 不能扩大权限。现有 UI 协调器的可变“当前项目”不作为多 Agent 全局作用域。
- 通用核心接收明确的记忆内容与来源，不自动抓取任意 Agent 的对话。宿主适配器负责提取允许捕获的会话事件；保存默认形成 pending 候选。
- 可信管理入口执行审核或删除；模型返回 `approved: true` 不是授权。检索内容是低信任事实，不能成为系统指令、用户授权或 Evolution 规则。
- 返回有界正文、记录状态、来源及时间；区分 Agent 自报引用与宿主观察证据。不保存凭据、完整工具输出或不必要的原始会话。
- 同一数据目录存在多调用者时，事务内检查与写入、持久幂等、迁移互斥和有限 busy 处理必须一起验证；不能只靠内存锁。
- 默认沿用项目隔离、候选审核、条数和序列化字节预算。未绑定和失败时明确不可用，不伪造“已记住”。

`AGENT.md` 描述已实现工具的使用规则；另外提供 Cordis 宿主接入文档，说明服务依赖、配置、数据目录、工具映射、销毁和验证。MD 本身不会注册工具或被所有 Agent 自动读取。

## 分阶段增强

1. **Cordis 解耦：** 核心子入口、Harness/Brain 适配、既有 Bundle 兼容和最小宿主示例。优先保留 schema 2；如幂等需要持久字段，先补增量迁移设计。
2. **可靠记忆：** 纠正链、过期、冲突、明确的删除语义；目前 forgotten 候选仍保留正文，不能描述成彻底擦除。
3. **迁移恢复：** 完整一致备份与原子恢复，密钥和数据库共同保留；换机显式重绑路径，不凭同名目录合并项目。现有项目 JSON 导出不是完整备份。
4. **检索质量：** 中英文相关性与无关查询评测、自有 FTS Worker 硬超时；可选语义检索另行评估，不默认上传记忆。

## 验收

- 在没有 `tools`、`dshHomePath`、`missherBrain` 的真实 Cordis 容器中加载 Core，以临时目录完成绑定、候选、审核、检索和释放。
- Harness adapter 缺 Brain 时仍可调用搜索；Brain 延迟出现、移除、重载不重复注册或泄漏资源。
- 隔离 DSH_HOME 和合成数据验证：跨项目拒绝、候选不可直接召回、来源、预算、并发、迁移回滚、损坏保护、卸载保留与重装恢复。不读取真实记忆作测试素材。
- 分别记录 `@deepseek-ai/cordis` 与上游 `cordis` 的精确版本和兼容测试；在上游实际通过前不宣称兼容，不擅自替换现有运行时依赖。
- Cordis 容器测试与真实 Agent 工具调用分开；真实 Harness/Desktop Brain 和设置页验收仍须单独完成。
- 当前 Node 要求为 `^22.19.0 || >=24.0.0`；未验收的平台不宣称可用。

本提案的基础阶段现已实施并生成新的 Cordis 候选包。上文的历史设计名 `missherMemory` 指新服务概念，实际使用 `missherMemoryService`；运行接入以 CORDIS.md 为准，不要复制尚未实现的后续功能。
