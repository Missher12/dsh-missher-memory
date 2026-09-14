# 官方 Harness 兼容切片

目标版本是官方 Harness 0.1.5-rc.2（对照源码 fb2c4b9e698e30edb738bca4cf0618587db7d203）、Cordis 4.0.2。实现从独立 Memory 提交 782617f5c5b4354677e7a49cf9a85665307ce104 接续，不复制 Desktop 托管层。公开 npm 精确包用于验收，npm integrity 和 lockfile 记录产物来源；没有把本机 Desktop 的同版本修改包作为原版。

问题：原 peer 范围不匹配 0.1.5-rc.2，Client 还引用已移除的 dsh-client-runtime。原因：预发布范围只覆盖 0.1.0 元组；官方已经把 Context 与 slots 服务分属 Cordis 和 ui-renderer。影响：旧安装证据不能证明新宿主可加载。推荐方案：显式加入目标 peer 版本，开发依赖锁定官方包，Client 从 Cordis 导入 Context，从 ui-renderer 导入 slots 声明，并把 ui-renderer 列入 Client 装配依赖。

只修改适配、依赖和验收代码。存储 schema 2、审核语义、检索算法、真实默认设置不变。pnpm-workspace.yaml 固定开发图中的官方传递 peer，避免旧锁文件与新依赖混用；公开包仍将宿主服务声明为可选 peer，Core 不要求安装整个增强包。

scripts/official-smoke.mjs 接收本地包与精确官方 dsh CLI 路径，创建独立 HOME、DSH_HOME 和 Profile，通过 dsh --profile 启动测试消费者。三个进程阶段分别验证建立记忆、卸载后基础服务、重装后新会话恢复。它使用官方 Agent 对象和 Tools 执行管线，不伪造这些宿主服务；管理动作由合成测试的可信操作者执行，不提供模型自批接口。

验收覆盖未绑定拒绝、pending 不可检索、审核后结果与来源、跨项目审核/读取拒绝、卸载后工具/服务缺失、state.db 和 key.bin 字节保留、相邻文件保留、新会话恢复同一来源引用。测试覆盖层级不包括模型请求、真实浏览器设置页或自动召回；捕获、召回、整理仅在测试 overlay 中关闭，原 bundle 默认保持不变。

运行前核验官方 CLI 安装来源。命令：node scripts/official-smoke.mjs <candidate.tgz> <official-dsh/lib/bin.js>。默认清理临时数据；MEMORY_SMOKE_KEEP=1 仅用于保留合成证据。真实宿主验收与跨平台矩阵由后续分配负责，不能用历史发布的四平台证据代替。
