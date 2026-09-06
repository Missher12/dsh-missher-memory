# dsh-missher-memory 维护交接

## 独立源码与分支

- 仓库：`Missher12/dsh-missher-memory`。
- 基线：`62b39596e17bad14787c6cf4f59d27962076a51b` / `main` / 0.2.0。
- 本地仓库：`/Users/missher/Documents/ChatGPT/dsh-missher-memory`。
- 维护工作树：`/Users/missher/Documents/ChatGPT/dsh-missher-memory/.worktrees/memory-maintenance`。
- 分支：`maintenance/memory-audit-20260906`；最终完整 SHA 使用该工作树 `git rev-parse HEAD`，包旁 `dist/maintenance-evidence/source-revision.json` 同步记录。
- 候选版本：`0.2.1-maintenance.0`，仅本地交付；没有推送、tag、Release 或远端 CI dispatch。

## 完成内容

本轮已盘点独立 manifest、入口、Host/Client/RPC、数据结构及全部测试布局。五项修复：遗忘清理派生胶囊、搜索包含已整理胶囊、召回总预算、严格相同正文整理、项目删除清理派生个人 FTS。schema 保持 2；不自动修复历史上已经误整理或已删除来源的胶囊。

修改文件分组：

- 运行逻辑：`src/host/state-store.ts`、`memory-tool.ts`、`brain-provider.ts`、`consolidation-policy.ts`。
- 回归：`tests/consolidation.spec.ts`、`memory-brain-provider.spec.ts`、`fts-search.spec.ts`、`schema-migration.spec.ts`、`host-activation.spec.ts`。
- 包与验证：`package.json`、`scripts/native-smoke.mjs`、`scripts/verify-package.mjs`、`tests/manifest.spec.ts`、`tests/cross-platform-ci.spec.ts`、`.github/workflows/cross-platform.yml`（只同步候选包名，不触发 CI）。
- 文档：`AGENT.md`、`README.md`、`README.zh.md`、`SECURITY.md`、`DATA-RETENTION.md`、`PROJECT_CONTEXT.md`、本文件、`docs/maintenance-audit-2026-09-06.zh.md`。`AGENT.md` 已加入包白名单和包验证器。

## 验证与包

- 环境：本机 darwin-x64，Node 25.6.0，pnpm 11.7.0；原版 `@deepseek-ai/dsh` CLI 0.1.1-rc.2。
- 基线：27 测试文件 / 109 测试通过。
- 修复版：28 测试文件 / 117 测试通过；包含每项已复现 Bug 的回归、真实 v1 无 FTS 迁移后检索、故障迁移事务回滚、superseded 胶囊清理、Cordis 等待必需 Brain 服务。
- `pnpm typecheck`、`pnpm build`、`pnpm pack`、package verifier、`git diff --check`；最终日志存放 `dist/maintenance-evidence/`。
- 包：`dist/dsh-missher-memory-0.2.1-maintenance.0.tgz`；精确大小与 SHA-256 见 `dist/maintenance-evidence/package-verification.json`。
- native CLI 在临时 DSH_HOME 安装→dump 配置→卸载→重装→恢复项目绑定和已审核检索→再次卸载；包运行于提供 synthetic tools/Brain 的 Cordis 容器。验证相邻数据/状态保留、外部合成库 hash 与 mtime 不变、隔离、搜索、候选审核、超时、缺库和坏库。
- 所有记忆内容都是临时合成数据；没有读取真实记忆数据库作为测试素材。

## 明确限制与下一步

**没有完成真实 Desktop Brain 注入/UI 验收。** 原版 Harness 缺 `missherBrain` 时整个插件不会激活；CLI 安装成功和合成 Brain smoke 不能替代该证据。Windows/ARM/Linux 本次没有运行原生验收，Node 最低支持版本本次未重跑。

新增能力具体设计见维护盘点：可选 Brain 适配器以支持原版手动检索；schema 3 的过期/替代/纠正；完整导出与恢复；胶囊来源/回滚 UI；自有 FTS Worker。用户尚未确认，未实施。Memory 不做 Evolution 规则晋升。

历史已生成胶囊不自动改写；现有 JSON 导出不是完整备份；遗忘仍保留 forgotten 候选正文。真实坏库恢复仅有失败开放保护，无备份导入流程。接续任务应先确认新增方案，继续本独立工作树，禁止修改 Desktop 或其他插件。未经发布指令不要 push/tag/Release。
