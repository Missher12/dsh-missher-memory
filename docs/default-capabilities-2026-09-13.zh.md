# 默认 Memory 能力的官方组合验收

产品运行时沿用 S2，不调整记忆算法、schema 或默认开关。新增确定性验收使用官方 Harness 0.1.5-rc.2 / Cordis 4.0.2 的 Profile、Agent、Session、Tools 与 DeepSeek 流协议适配器，所有模型响应来自仅监听 127.0.0.1 的本地 HTTP 服务。隔离 HOME、DSH_HOME、Profile 和合成记忆；凭据仅为测试常量，不加载真实账户。

默认捕获由真实 Session 回合及 disposal 触发。未绑定不建库；已绑定项目默认捕获用户和助手文字，先生成 pending，只有可信操作者审核后可检索。插件来源的 recall 消息不再次进入候选。

现有 Brain 是可选消费方。准备命令为 `node scripts/prepare-brain-fixture.mjs <desktop-git-root> <ignored-fixture-directory>`；仅从 Desktop d1e8bd9c6d49f980405888099087f931ddd26d83 提取五个固定文件，记录输入和转译输出哈希。这是测试产物，不是第二份产品实现，不随 Memory 分发，也不启用真实配置中已停用的 Brain。

执行命令为 `node scripts/official-smoke.mjs <memory.tgz> <official-dsh/lib/bin.js> --defaults <brain-fixture/index.js>`。测试显式移除并恢复这个可选 Hub，确认 provider 注册不重复、手动工具仍可用、实际模型请求与记录在 Session 中的召回内容一致、每轮一条贡献、跨项目不泄漏。无 Brain 时无新召回消息；不能用手动工具可用声称无 Brain 也能自动召回。

默认维护由产品实际 30 秒首次定时器触发；仅将测试库中四条相同已审核记录的日期设为旧日期，不缩短产品延迟、不添加测试钩子。断言出现一个可检索胶囊及 automatic maintenance 回执。卸载保留 state.db、key.bin 的字节和相邻数据，重装后的新 Session 恢复既有来源。

验证只证明这些固定包与既有 Hub 快照在 Intel macOS / Node 25.6.0 的行为。真实 Desktop UI、真实模型质量、其他系统和最终增强包组合不由本测试替代。源码/包哈希、19 项定向测试及 12 次 loopback 请求证据在 dist/r7。最终桌面组合由总指挥锁定后，只复验受影响路径。
