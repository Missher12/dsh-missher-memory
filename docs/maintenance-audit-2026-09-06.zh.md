# 长期记忆插件维护盘点（2026-09-06）

## 来源与工作范围

- 权威源码：`https://github.com/Missher12/dsh-missher-memory`，GitHub owner/name 已通过 `gh repo view` 核验。
- 本地 Documents 与 Codex worktrees 的 Git origin 搜索未找到对应检出，因而新建独立 clone。
- 基线：`main` / `62b39596e17bad14787c6cf4f59d27962076a51b`，manifest **0.2.0**；历史 0.1.0 不作为当前版本。
- 维护分支：`maintenance/memory-audit-20260906`；工作树：独立仓库下 `.worktrees/memory-maintenance`。原检出无未提交修改。
- 本次仅修改 Memory 插件；无 Desktop/Evolution 修改，无 push、tag 或 Release。

## 实际架构与激活路径

`package.json:dsh.bundle.patch` → `cordis.patch.yml` → `lib/index.js` → Cordis 必需服务 `tools`、`dshHomePath`、`missherBrain` → 注册 `memory_search`、RPC、session hooks、Memory Brain provider。Client 依赖 Harness 的 settings/runtime/locale/remotes 服务。没有将 Desktop 托管层当作插件源代码。

原版 CLI 可安装、组合 profile，但缺少 Brain 服务会使整个 Host 插件等待依赖，搜索和候选捕获也不会注册。仓库 README 声明 Desktop 0.3.8 提供该服务；这只是版本要求，不能代替本次真实 Desktop 验收。现有 CI 固定旧 Desktop 0.3.6 CLI，其 smoke 手动提供 Brain mock，不能证明 0.3.8 实际激活。

`RecallService` 是遗留直接注入实现，当前入口不注册它。真实自动注入由宿主 Brain 完成。本插件贡献的是事实候选，不注册规则晋升，不负责 Evolution 的规则生命周期。

## 已修复的回归

1. **P1 遗忘派生胶囊残留**：事务内删除受影响胶囊及 FTS，包括 superseded 胶囊；恢复未被遗忘的其余来源，再删除目标原子。重新打开后仍不可恢复被遗忘的派生内容。其他独立来源可能仍然包含相同事实，这是来源级遗忘的既有语义。
2. **P1 整理后显式检索丢失**：`memory_search` 的项目搜索加入 active capsule 索引，保持绑定、隐私过滤、条数/字节预算和稳定引用。personal 搜索不读取项目胶囊。
3. **P1 召回预算失效**：provider 在多个来源合并后，执行项目总条数与 UTF-8 序列化预算，去除重复 handle 并再次过滤敏感正文。保持现有 provider 3000-byte 上限；宿主最终消息包装仍需宿主计入总预算。
4. **P1 “完全重复”误合并**：去掉 NFKC、大小写折叠和空白压缩；分组及提交校验都要求正文逐字符一致，避免改变代码标识符、字面量或缩进语义。不自动改写已存在胶囊。
5. **P1 项目删除的个人记忆索引残留**：删除项目派生的全局个人记忆时，同时删除其 FTS 词项，避免正文已删除但索引仍保留词项。
6. **验证证据修正**：smoke 明确输出模拟宿主服务模式和 `realHostActivationVerified: false`，实际安装数据根用于生命周期，并增加卸载→重装→绑定和已审核检索恢复→再次卸载。

## 重点盘点与下一步具体方案（未实施新增能力）

| 维度 | 当前证据与限制 | 优先级 |
| --- | --- | --- |
| 项目隔离 | 可信 session cwd → HMAC alias → 用户绑定；SQL 按 project key；个人偏好明确全局，来源绑定禁止跨项目重用 | 持续回归 |
| 相关性 | FTS5 字面词 AND、中日韩二元组、BM25；固定项优先。Brain 映射为固定分值，跨来源排序不保留 BM25；长自然语言可能零命中 | P2 |
| 来源 | 原子→候选 ID；候选包含会话 HMAC；胶囊保留原子 ID/checksum。无原始会话跳转；整理更新的时间不等于事实发生时间 | P1 |
| 过期/冲突 | 无 expiresAt、supersedes、冲突组。矛盾的已审核记忆可同时召回；不得默认最新记录必然正确 | P1 |
| 纠正/删除 | 只能编辑 pending；已审核内容须遗忘后重新提交。项目删除清理所属内容；遗忘保留 forgotten 候选正文，不等于磁盘安全擦除 | P1 |
| 迁移/损坏 | schema 1→2 事务迁移，未来版本拒绝；缺密钥/坏库失败开放。无自动备份恢复/用户导入恢复流程 | P1 |
| 导出/胶囊操作 | 导出不是完整备份：只含候选与 active 项目原子；未导出胶囊和 archived 原子。胶囊 rollback 是内部 API，尚无 RPC/UI 操作入口 | P1 |
| 执行隔离 | 外部 SQLite 在可终止 Worker；自有 FTS 和整理读取实际仍为主线程 `DatabaseSync`，并非上下文旧文所称均在 Worker | P1 |
| 注入信任 | tool 描述明确检索不授权；Brain contribution 是数据结构，最终角色、包裹和指令防护依赖宿主；未做实际模型注入攻击验收 | P1 |

### 原版 Harness 支持

问题：强制 Brain 依赖阻止普通 Harness 激活全部记忆能力。
原因：0.2.0 把搜索/捕获和 Brain 注册放进同一必需依赖入口。
影响：安装成功但工具缺失。
推荐方案：拆成始终依赖 tools/dshHomePath 的核心与可选 Brain 适配器；无 Brain 时明确显示“手动检索可用、自动召回不可用”。不恢复另一套隐式注入器；验收覆盖无 Brain、延迟注册、服务移除/重挂载和无重复工具注册。是否需要原版自动召回另立方案。

### 过期、纠正和冲突

问题：已审核不代表永久有效，当前无法声明事实被替代。
原因：缺少有效期、替代关系与审核状态模型。
影响：历史配置、旧 SHA 和矛盾结论可能继续被注入。
推荐方案：schema 3 增加 nullable `expires_at`、`supersedes_id`、`verification_status`，保留独立 `recorded_at` 与操作时间；默认不猜测有效期。新增“纠正”操作在同一事务创建新版本并标记旧版 superseded，冲突只提示人工选择，不自动晋升规则。验收覆盖时间边界、撤销、迁移和跨项目非法引用。

### 恢复、完整导出与来源界面

问题：当前导出不足以重建胶囊状态，损坏只有失败开放。
原因：导出仍沿用 v1 视图，缺少完整恢复协议。
影响：用户可能把 JSON 导出误认为备份。
推荐方案：新增版本化完整逻辑导出（候选、active/archived 原子、胶囊、来源边；不泄露 cwd/session key），先校验 checksum/引用再暂存导入；备份 state.db 与 local key 必须同一停机快照。设置页补胶囊来源及回滚。损坏数据绝不静默重建或覆盖；验收使用合成损坏、缺密钥、故障注入和回滚。

### 检索与执行预算

问题：FTS/整理的同步执行可阻塞 Host，相关性还缺实际项目语料评价。
原因：数据库同步调用位于主线程，排序指标跨来源没有统一语义。
影响：50k 合成检索低延迟不代表硬超时或真实召回质量。
推荐方案：先将只读自有 FTS 移至可终止 Worker，保留写事务单所有者；再建立合成中英文评测集，报告 recall@k、无关命中及跨项目零泄漏。采用可解释降级查询前先比较基线，避免直接引入 embedding 或模型自动改写。

## 验证分层

所有数据库内容为临时合成数据，不读取真实记忆。基线 27 文件/109 项通过；最终结果记录在 HANDOVER.md。覆盖字面检索、跨项目隔离、迁移后 FTS、重新打开、遗忘、安装卸载重装、缺失及损坏外部库、Worker 超时、外部库 hash/mtime 不变。

- 单元/集成：真实 SQLite 与 Cordis 依赖激活测试；Brain 服务为测试替身。
- 本机 native CLI：使用安装的官方 `@deepseek-ai/dsh` 0.1.1-rc.2，在临时 DSH_HOME 执行 add/dump/remove；不使用用户 profile。
- packaged runtime：独立 Cordis 容器中加载包，tools/Brain 为合成服务。
- **未验证**：真实 Desktop Brain 注入及设置 UI；Windows、Apple Silicon、Linux 本次原生运行；完整坏库备份恢复；真实长期语料相关性。没有发布或触发远端 CI。
