# DeepSeek Harness 超级记忆插件实施计划

> **执行要求：** 使用 `superpowers:executing-plans` 逐项实施；每个行为遵循 red → green → refactor，测试必须先观察到预期失败。

**目标：** 交付独立安装的 `dsh-missher-memory` bundle，提供项目隔离的只读记忆搜索、默认关闭的候选审核工作流和默认关闭的预算化自动召回。

**架构：** Host Cordis 插件通过 Worker 中的 Node `node:sqlite` 读取外部 `vectors.db`，通过延迟创建的插件 `state.db` 保存显式 binding、设置和审核状态。Client 通过 Harness 原生设置 section 操作脱敏 RPC。所有运行入口失败开放，真实数据库只用于最终非正文只读校验。

**技术栈：** TypeScript 6、Node 22.19+/24+、`node:sqlite`、Cordis、Harness Host/Client/Typert、React、Schemastery、Zod、Vitest、tsdown、pnpm。

---

## Task 1：建立可独立构建的 bundle 骨架

**文件：**

- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `cordis.patch.yml`
- Create: `tsconfig.json`
- Create: `tsconfig.client.json`
- Create: `tsdown.config.ts`
- Create: `vitest.config.ts`
- Create: `LICENSE`
- Create: `src/index.ts`
- Create: `src/client/index.ts`
- Create: `tests/manifest.spec.ts`

**步骤：**

1. 先写 manifest 测试，要求 package 名、engines、Host/Client exports、`dsh.bundle.patch`、Client inject、files 白名单、零 lifecycle scripts 和所有运行时 peer 范围。
2. 运行 `pnpm exec vitest run tests/manifest.spec.ts`，确认因文件缺失/字段缺失失败。
3. 添加最小 package/config/空插件导出，使 manifest 测试通过。
4. 使用离线优先的 `pnpm install` 生成锁文件；不得修改仓库根 lockfile。
5. 运行 focused test、`pnpm exec tsc -p tsconfig.json --noEmit` 和 `pnpm exec tsc -p tsconfig.client.json --noEmit`。
6. 提交：`feat(memory): scaffold standalone Harness bundle`。

## Task 2：路径策略和零创建数据库探测

**文件：**

- Create: `src/host/path-policy.ts`
- Create: `src/host/database-status.ts`
- Create: `src/shared/types.ts`
- Create: `tests/path-policy.spec.ts`
- Create: `tests/database-status.spec.ts`

**步骤：**

1. 写失败测试覆盖相对覆盖路径、根目录 symlink、DB symlink、DB 逃逸、缺失 DB、非普通文件和合法绝对路径。
2. 写失败测试证明探测缺失 DB 后没有创建根目录、DB、state 目录或任何文件。
3. 实现 `lstat` + `realpath` + containment，明确区分 `unconfigured`、`ready`、`incompatible`、`corrupt`。
4. `node:sqlite` 以 `readOnly: true`、`allowExtension: false` 探测固定表/FTS schema；错误先脱敏再返回。
5. 跑 focused tests，确认路径和状态行为通过。
6. 提交：`feat(memory): add read-only database discovery`。

## Task 3：安全 FTS 规范化、预算和隐私过滤

**文件：**

- Create: `src/host/query-policy.ts`
- Create: `src/host/budget.ts`
- Create: `src/host/privacy.ts`
- Create: `tests/query-policy.spec.ts`
- Create: `tests/budget.spec.ts`
- Create: `tests/privacy.spec.ts`

**步骤：**

1. 写失败测试覆盖空白、超长 Unicode、引号、括号、`OR/NOT/NEAR`、SQL 注释、NUL、emoji 和组合字符。
2. 期望输出只由双引号 token 与固定 `AND` 组成，调用者不能提供 SQL/列名/MATCH 表达式。
3. 写失败测试覆盖 UTF-8 byte 截断、条数硬上限、来源字段保留和无半个 surrogate/code point。
4. 写失败测试覆盖 API key、cookie、密码、私钥、连接串、身份证件/金融账号模式、`.env` 和绝对敏感路径；只断言拒绝状态，快照不包含秘密样本。
5. 实现纯函数并跑 focused tests。
6. 提交：`feat(memory): enforce query and privacy budgets`。

## Task 4：Worker 只读搜索、项目过滤和硬超时

**文件：**

- Create: `src/workers/sqlite-reader.worker.ts`
- Create: `src/host/reader-worker.ts`
- Create: `src/host/search-service.ts`
- Create: `tests/fixtures/create-memory-db.ts`
- Create: `tests/search-service.spec.ts`
- Create: `tests/reader-worker.spec.ts`

**步骤：**

1. 使用合成 SQLite fixture 写失败测试：只返回显式允许的 session keys；同查询的其他项目不可见；悬空 FTS 行不可见；来源和时间正确。
2. 测试 SQL/FTS 输入不能改变过滤；查询参数和 session keys 全部绑定。
3. 测试无 DB、损坏 DB、schema 不兼容返回结构化状态且搜索调用不中断。
4. 为测试 Worker 增加固定的延迟夹具，写失败测试证明 deadline 后终止旧 Worker、返回 timeout，下一查询由新 Worker 成功处理。
5. 实现 Worker 协议、固定 l1/l0 SQL、结果隐私过滤和 UTF-8 预算。
6. 跑 focused tests 和 typecheck。
7. 提交：`feat(memory): add isolated read-only search worker`。

## Task 5：延迟 state.db、权威项目 binding 和加密映射

**文件：**

- Create: `src/host/project-identity.ts`
- Create: `src/host/state-store.ts`
- Create: `src/host/local-key.ts`
- Create: `tests/project-identity.spec.ts`
- Create: `tests/state-store.spec.ts`
- Create: `tests/zero-state.spec.ts`

**步骤：**

1. 写失败测试证明 cwd 只能生成内存候选；持久化项目只有随机/不可逆 key、basename、短 hash，不含绝对 cwd。
2. 写失败测试证明插件 load/status/unbound search/bound search/capture-off `session/disposed` 均不创建 state 目录、DB、journal、WAL 或 key。
3. 写失败测试证明显式 bind 才延迟创建 mode 700 目录、mode 600 DB/key，并在一个事务写入 project、cwd keyed hash 和加密 session mapping。
4. 写跨 worktree 测试：两个 cwd 候选可以显式关联同一 binding；basename 相同但未关联时不自动合并。
5. 写跨项目隔离、错误密钥、篡改 ciphertext、无密钥不降级明文、删除项目事务和状态 schema 迁移测试。
6. 实现 AES-256-GCM 本地密钥、keyed hash 和单调 schema。
7. 跑 focused tests；检查所有错误/导出不含绝对 cwd 或明文 session key。
8. 提交：`feat(memory): add explicit encrypted project bindings`。

## Task 6：注册 `memory_search` 工具和 Host RPC

**文件：**

- Create: `src/host/memory-tool.ts`
- Create: `src/remote-contract.ts`
- Create: `src/remote.ts`
- Create: `src/typert.host.ts`
- Create: `src/typert.remote-client.ts`
- Modify: `src/index.ts`
- Create: `tests/memory-tool.spec.ts`
- Create: `tests/remote.spec.ts`

**步骤：**

1. 写失败测试覆盖未绑定、未配置、ready、timeout、个人 scope、project scope、limit 和 budget。
2. 测试工具 presentation 为 generic，展示项目短 hash、命中和截断，不暴露 cwd/session key。
3. 写 RPC parser/authorization 测试：所有路径、秘密和内部异常在跨线前脱敏；写操作必须是显式 action。
4. 实现 Tool 注册和 Remote 方法；所有 Cordis 注册通过 effects，apply/teardown 失败开放。
5. 跑 focused tests、Host typecheck 和 build。
6. 提交：`feat(memory): expose project-scoped memory search`。

## Task 7：候选捕获、审核事务和敏感拒绝

**文件：**

- Create: `src/host/capture-buffer.ts`
- Create: `src/host/candidate-service.ts`
- Create: `src/host/lifecycle.ts`
- Modify: `src/host/state-store.ts`
- Modify: `src/index.ts`
- Create: `tests/capture-buffer.spec.ts`
- Create: `tests/candidate-service.spec.ts`
- Create: `tests/lifecycle.spec.ts`

**步骤：**

1. 写失败测试证明默认关闭、未绑定、仅绑定但未开启、子代理、工具结果和敏感会话均不缓冲、不写文件。
2. 写失败测试证明显式绑定并开启后，只缓冲受限的直接用户/助手文本；单会话和单条 byte budget 生效。
3. 写 `session/disposed` 测试：符合条件才创建 pending candidate；重复 dispose 幂等；过滤为空不写；错误不阻止 teardown。
4. 写审核通过、编辑、合并、固定、遗忘、scope 更改、项目删除和导出测试；每个动作使用事务和脱敏 audit。
5. 实现无工具输出的确定性候选提取；如接入 LLM，只允许可注入的 provider 接口且默认不启用，测试使用固定 provider。
6. 跑 focused tests、typecheck。
7. 提交：`feat(memory): add reviewed candidate inbox`。

## Task 8：自动召回和可重放上下文事件

**文件：**

- Create: `src/host/recall-service.ts`
- Modify: `src/host/lifecycle.ts`
- Modify: `src/index.ts`
- Create: `tests/recall-service.spec.ts`
- Create: `tests/recall-lifecycle.spec.ts`

**步骤：**

1. 写失败测试证明召回默认关闭，且与候选捕获开关独立。
2. 覆盖未绑定、子代理、工具/系统消息、非直接用户输入、超时和错误均不注入并继续调用 waterfall `next()`。
3. 覆盖默认 3/3000 bytes 和硬上限 5/6000 bytes，来源与时间保留，不可信包装存在。
4. 覆盖任何模型可见召回都产生插件来源 session event，可从日志重放；未注入时无事件。
5. 实现 recall service 和 hook，跑 focused tests/typecheck。
6. 提交：`feat(memory): add opt-in bounded auto recall`。

## Task 9：Harness 原生设置页

**文件：**

- Create: `src/client/contract.ts`
- Create: `src/client/locales.ts`
- Create: `src/client/css-modules.d.ts`
- Create: `src/client/MemorySection.tsx`
- Create: `src/client/MemorySection.module.css`
- Modify: `src/client/index.ts`
- Create: `tests/client-section.spec.tsx`

**步骤：**

1. 写失败测试覆盖稳定首屏占位、状态刷新、未配置、同名短 hash、默认关闭开关、预算限制、候选审核和来源时间。
2. 测试 UI 不显示绝对 cwd、明文 session key、内部错误或真实正文夹具。
3. 实现 `settings.section`，遵循 Harness 现有布局和组件；绑定/开启/删除等写操作需要明确确认语义。
4. 添加中英文 locale，运行 Client test、typecheck 和 browser build。
5. 提交：`feat(memory): add native memory settings section`。

## Task 10：文档、包验证和临时 profile smoke

**文件：**

- Create: `README.md`
- Create: `docs/SECURITY.md`
- Create: `docs/DATA-RETENTION.md`
- Create: `scripts/verify-package.mjs`
- Create: `scripts/packaged-smoke.mjs`
- Create: `tests/package-contents.spec.ts`
- Modify: `PROJECT_CONTEXT.md`

**步骤：**

1. 写失败测试/验证器，拒绝 DB、fixture DB、日志、绝对用户路径、密钥、源文件、install scripts 和未白名单文件进入 tarball。
2. 写 README：安装、绑定、搜索、候选、召回、卸载、默认保留数据、显式删除/导出、故障状态和 `MISSHER_TENCENTDB_DIR`。
3. 构建并 `pnpm pack`；运行 package contents 测试。
4. 在临时 `DSH_HOME` 运行 add/dump/remove smoke；验证 bundle patch、Host/Client exports、卸载后 state 保留且外部 fixture 未改变。
5. 使用合成 DB 运行 packaged search smoke，覆盖无 DB/坏 DB/跨项目/超时，不使用真实正文。
6. 提交：`docs(memory): document installation and data retention`。

## Task 11：最终验证和真实数据库非正文校验

**文件：**

- Modify: `PROJECT_CONTEXT.md`
- Create: `.agents/notes/implemented/features/2026-08-23-dsh-missher-memory.md`

**步骤：**

1. 运行所有插件 unit/lifecycle/client/package tests。
2. 运行 Host/Client typecheck、lint、build 和 `git diff --check`。
3. 对最终 tarball 运行 verifier，记录路径、size、SHA-256。
4. 对真实 `vectors.db` 先记录 SHA-256、mtime、size；只执行 status/schema/count smoke，不输出正文；随后再次记录并要求全部相等。
5. 对插件状态使用临时 `DSH_HOME`，确认真实记忆根下没有新文件。
6. 更新 `PROJECT_CONTEXT.md` 的进度、测试证据和已知风险。
7. 最终提交：`test(memory): verify packaged fail-open delivery`。

## 交付门槛

只有以下全部成立才报告完成：

- 工作树仅包含本插件和必要 Agent Note 的有意改动。
- 默认完整生命周期和只读搜索零状态创建测试通过。
- 真实数据库测试前后 SHA-256、mtime、size 完全一致。
- tarball 不含任何数据库、真实正文、凭据、绝对用户路径或安装脚本。
- packaged smoke 使用 tarball 内的构建产物而非源码。
- 不合并、不发布、不修改其他 worktree。
