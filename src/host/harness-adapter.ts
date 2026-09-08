import type { Context } from '@deepseek-ai/cordis'
import type { ResolvedPluginConfig } from '../index.ts'
import { memoryRuntime } from './memory-service.ts'
import { MemoryBrainProvider } from './brain-provider.ts'
import brainAdapter from './brain-adapter.ts'
import { MemoryCoordinator } from './coordinator.ts'
import { CandidateService } from './candidate-service.ts'
import { ConsolidationScheduler } from './consolidation-scheduler.ts'
import { ConsolidationService } from './consolidation-service.ts'
import { CaptureBuffer } from './capture-buffer.ts'
import { MemoryLifecycle } from './lifecycle.ts'
import { createMemorySearchTool } from './memory-tool.ts'
import { SourceDiscoveryService } from './source-discovery.ts'
import { MissherMemoryRemote } from '../remote.ts'

export const name = 'missher-memory-harness-adapter'
export const inject = ['missherMemoryService', 'tools']

/** Harness owns its tools, RPC and session hooks; the core owns storage and the reader. */
export function apply(ctx: Context, config: ResolvedPluginConfig): void {
  const runtime = memoryRuntime(ctx.missherMemoryService)
  const { state, reader, search, database } = runtime
  const coordinator = new MemoryCoordinator({
    state, database, discovery: new SourceDiscoveryService(reader, database, config.searchTimeoutMs),
  })
  const brainProvider = new MemoryBrainProvider({ state, legacy: search, database, timeoutMs: config.searchTimeoutMs })
  const scheduler = new ConsolidationScheduler({ state, service: new ConsolidationService({ store: state }) })
  const lifecycle = new MemoryLifecycle({
    store: state, candidates: new CandidateService(state),
    buffer: new CaptureBuffer({ maxMessages: 32, maxSessionBytes: 32_000, maxMessageBytes: 2_000 }),
  })
  ctx.effect(() => async () => {
    scheduler.dispose()
    await lifecycle.close()
  }, 'dsh-missher-memory: dispose Harness adapter')
  ctx.provide('missherMemoryCore', coordinator)
  new MissherMemoryRemote(ctx, coordinator)
  ctx.tools.register(createMemorySearchTool(runtime))
  ctx.on('session/created', session => {
    if (session.header.cwd === undefined) return
    if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0) return
    brainProvider.noteSession(session.id, session.header.cwd)
    void coordinator.noteCwd(session.header.cwd)
  })
  ctx.on('session/event', (session, event) => lifecycle.onEvent(session, event))
  ctx.on('session/disposed', session => {
    lifecycle.onDisposed(session)
    brainProvider.forgetSession(session.id)
  })
  ctx.plugin(brainAdapter, brainProvider)
  if (config.consolidationEnabled) scheduler.start()
}

export default { name, inject, apply }
