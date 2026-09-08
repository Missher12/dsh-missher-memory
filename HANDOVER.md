# dsh-missher-memory Cordis 升级交接

## 任务与来源

用户明确选择 Cordis 并授权实施。本轮完成通用 Core 与 Harness/Brain 适配解耦，保持独立仓库和旧数据，不新增 MCP/HTTP/独立 CLI，不修改 Desktop 或 Evolution。

- origin：`https://github.com/Missher12/dsh-missher-memory.git`。
- 根仓库 main 基线：`62b39596e17bad14787c6cf4f59d27962076a51b` / 0.2.0。
- 本轮开始 SHA：`887f2ca838452b76219827fdf11d4e1e089d73b1`，已有维护修复及 AGENT.md。
- 工作树：`/Users/missher/Documents/ChatGPT/dsh-missher-memory/.worktrees/memory-maintenance`。
- 分支：`maintenance/memory-audit-20260906`。
- 发布版本：`0.3.0-cordis.0`（预发布）；schema 2。2026-09-08 用户明确授权发布与 DSH 商店收录；仅本插件范围。
- 最终完整 SHA、父提交、修改列表与包哈希在 `dist/cordis-evidence/`；用 `git rev-parse HEAD` 核验，不用本交接文本形成自引用 SHA。

## 实现

1. 新增 `src/core.ts`，包导出 `./core`。通用 Context 只需要 provide/effect；服务名 `missherMemoryService`，不会占用旧 RPC 的 `missherMemory`。
2. 新增 MemoryService：明确绑定、冻结项目 facade、默认禁止个人全局范围、search/get/propose、独立 admin 审核与遗忘、输入快照、队列与关闭。无 Harness 服务也能加载。
3. 抽出 project-search，保持 Harness 工具接口与来源格式；修复已绑定空项目被错误报告为 project-unbound 的情况。
4. Harness adapter 保留原捕获、RPC、设置页、整理；Brain adapter 单独管理 provider 的依赖和注销。Brain 缺失、恢复和移除不影响手动工具。
5. key.bin 使用完整写入后原子发布；schema/FTS 初始化与迁移原子化；候选创建、审核及遗忘的相关状态在事务中检查。幂等重试不重复创建审计。定向 get 可追溯胶囊的归档来源。
   已有数据库缺失密钥时，重新绑定返回 corrupt，保持密钥缺失与数据库字节不变，不生成错误替代密钥。
6. 安装包新增 CORDIS.md、core JS/类型入口和共享 chunk。Host peer 包保持可选；上游 cordis 仅用于开发验证，不捆绑第二个 Cordis runtime。
7. CI 增加独立 Cordis smoke 与对应证据，版本路径同步；实现阶段未触发；发布阶段运行远端 CI 并记录 run/SHA。

## 修改文件

核心：`src/core.ts`、`src/index.ts`、`src/host/memory-service.ts`、`project-search.ts`、`memory-tool.ts`、`harness-adapter.ts`、`brain-adapter.ts`、`state-store.ts`、`local-key.ts`。

验证与打包：`tests/cordis-core.spec.ts`、`host-activation.spec.ts`、`manifest.spec.ts`、`package-contents.spec.ts`、`cross-platform-ci.spec.ts`；`scripts/cordis-smoke.mjs`、`native-smoke.mjs`、`verify-package.mjs`；`package.json`、`pnpm-lock.yaml`、`tsdown.config.ts`、`.github/workflows/cross-platform.yml`。

文档：`CORDIS.md`、`AGENT.md`、中英文 README、SECURITY.md、DATA-RETENTION.md、PROJECT_CONTEXT.md、HANDOVER.md、Cordis 提案。精确 Git 路径列表以最终 source-revision.json 为准。密钥保护回归在 `tests/state-store.spec.ts`。

## 验证与可安装包

包：`dist/dsh-missher-memory-0.3.0-cordis.0.tgz`；最终大小与 SHA-256 见 `dist/cordis-evidence/package-verification.json`。本轮验证：

- 单元/集成：29 文件 / 121 测试，通过两种真实 Cordis 容器的审核、隔离、来源读取、重载；缺 Brain 时实际执行 Harness 工具；旧迁移、检索、损坏保护、回滚与 UI 单测仍通过。
- typecheck/build/package verifier/git diff --check。
- 独立包：临时目录导入 Core，不链接任何 Harness peer。上游 cordis 4.0.0-rc.9 与 @deepseek-ai/cordis 4.0.1 生命周期通过；4 个独立进程并发初始化/候选/审核，最终一条审核记录。
- Node 25.6.0 / darwin-x64；Core 包也在最低 Node 22.19.0 运行上述 smoke。
- Harness CLI 0.1.1-rc.2 真实安装、配置组合、卸载、重装；运行态采用 synthetic tools/Brain 的 Cordis 容器。验证项目隔离、捕获审核、恢复、外部库超时/缺失/损坏、相邻文件与状态保留、外部合成库 hash/mtime 不变。

所有数据为临时合成数据；未读取真实记忆作测试。最终命令使用隔离 DSH_HOME，日志见 `dist/cordis-evidence/`。测试不等于实际模型工具调用或 Desktop 原生 UI。

共享工作站并行复验时，既有 Worker 成功路径的 1000ms 预算出现超时；保留高并发及两 worker 的失败日志，最终全量采用 `pnpm test --maxWorkers=1`。不修改生产时限或这些单元测试的断言；多进程数据一致性另由 packaged smoke 验证。

## 本轮排障

CLI 安装后首次来源列表为空，诊断确认数据库 ready、项目候选有效，独立 Worker 探针成功耗时 122ms；旧 smoke 全程只给 100ms，冷启动未完成即取消。正常安装验收改用产品默认 1500ms；由于 SQLite 自身锁等待为 250ms，超时验收使用独立的 100ms 实例，保留强制锁库并断言 timeout。诊断探针只在 DSH_SMOKE_DEBUG=1 且初始快照失败时读取合成 fixture，不放宽生产查询限制。

## 兼容性与剩余工作

- Cordis Core 是通用服务，不自动为任意 Agent 注册工具；宿主必须加载兼容运行时并映射可信项目 facade。详见 CORDIS.md。
- 上游 rc.9 的声明文件在 NodeNext 有无扩展名 re-export 问题；已验证 JS runtime，未声称修复上游类型包。Core 自身只依赖结构化 Context 类型。
- 真实 Agent 模型、Desktop Brain 注入和设置页 UI 尚未验收；其他平台本轮未原生运行，不能用 CI 配置代替结果。
- schema 2 未新增过期/纠正链/冲突解决；自有 SQLite 查询仍同步；完整备份恢复未实施；forgotten 候选正文仍保留。此前规划的这些增强继续独立推进，不混入本次 Cordis 接入完成声明。
- 任何后续源码或打包文档修改都需要重建包并重绑最终证据。本次已有发布指令；不编辑其他插件、Desktop 工作树或真实数据。商店 PR 仅添加本插件条目。

## 商店发布流程（2026-09-08）

- 发布 `v0.3.0-cordis.0` 为 GitHub prerelease，保留真实 Agent/UI 验收限制，不把候选提升为稳定版。
- 收录源：`awesome-dsh-plugin/awesome-dsh-plugin` 的 `data/plugins/Missher12__dsh-missher-memory.yml`，分类 memory；只提交这一条目，使用固定版本 `.tgz` Release URL。
- 远端分支以 fast-forward 发布，不改写历史；包与证据绑定同一提交，公开下载后复核 SHA-256。
- 发布/收录状态分别查询 GitHub Release、收录 PR、在线 `https://awesome-dsh-plugin.com/plugins.json`。PR 等待维护者合并期间，商店可能仍搜不到。公开验收记录在 `dist/store-release/`，不发布含本机路径的旧 source-revision.json。
