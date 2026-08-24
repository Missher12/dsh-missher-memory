import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import { MemoryBrainProvider, type MemoryBrainHubLike } from './host/brain-provider.ts'
import { MemoryCoordinator } from './host/coordinator.ts'
import { CandidateService } from './host/candidate-service.ts'
import { ConsolidationScheduler } from './host/consolidation-scheduler.ts'
import { ConsolidationService } from './host/consolidation-service.ts'
import { CaptureBuffer } from './host/capture-buffer.ts'
import { MemoryLifecycle } from './host/lifecycle.ts'
import { createMemorySearchTool } from './host/memory-tool.ts'
import { ReaderWorker } from './host/reader-worker.ts'
import { MemorySearchService } from './host/search-service.ts'
import { StateStore } from './host/state-store.ts'
import { SourceDiscoveryService } from './host/source-discovery.ts'
import { MissherMemoryRemote } from './remote.ts'

/** Cordis plugin identifier. */
export const name = 'missher-memory'

/** Harness services required by the Host face. */
export const inject = ['tools', 'dshHomePath', 'missherBrain']

/** Deployment configuration for search, capture, and recall limits. */
export interface PluginConfig {
  enabled?: boolean
  captureEnabled?: boolean
  recallEnabled?: boolean
  consolidationEnabled?: boolean
  searchTimeoutMs?: number
  maxSearchResults?: number
  searchByteBudget?: number
  recallLimit?: number
  recallByteBudget?: number
}

interface ResolvedPluginConfig {
  enabled: boolean
  captureEnabled: boolean
  recallEnabled: boolean
  consolidationEnabled: boolean
  searchTimeoutMs: number
  maxSearchResults: number
  searchByteBudget: number
  recallLimit: number
  recallByteBudget: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshHomePath(...segments: string[]): string
    missherMemoryCore: MemoryCoordinator
    missherBrain: MemoryBrainHubLike
  }
}

/** Schemastery surface used by Loader and generated configuration UI. */
export const Config: z<PluginConfig> = z.object({
  enabled: z.boolean(),
  captureEnabled: z.boolean(),
  recallEnabled: z.boolean(),
  consolidationEnabled: z.boolean(),
  searchTimeoutMs: z.number(),
  maxSearchResults: z.number(),
  searchByteBudget: z.number(),
  recallLimit: z.number(),
  recallByteBudget: z.number(),
})

/**
 * Registers the fail-open Host tool, RPC, and top-level project discovery hooks.
 *
 * @param ctx Harness Cordis context.
 * @param input Deployment configuration from the bundle patch.
 */
export function apply(ctx: Context, input: PluginConfig = {}): void {
  let reader: ReaderWorker | undefined
  let lifecycle: MemoryLifecycle | undefined
  try {
    const config = resolveConfig(input)
    if (!config.enabled) return
    const state = new StateStore({
      stateDirectory: ctx.dshHomePath('missher-memory'),
      defaultCaptureEnabled: config.captureEnabled,
      defaultRecallEnabled: config.recallEnabled,
      defaultRecallLimit: config.recallLimit,
      defaultRecallByteBudget: config.recallByteBudget,
    })
    reader = new ReaderWorker()
    const search = new MemorySearchService(reader)
    const database = {
      ...(process.env.MISSHER_TENCENTDB_DIR === undefined
        ? {}
        : { overrideRoot: process.env.MISSHER_TENCENTDB_DIR }),
    }
    const coordinator = new MemoryCoordinator({
      state,
      database,
      discovery: new SourceDiscoveryService(reader, database, config.searchTimeoutMs),
    })
    const brainProvider = new MemoryBrainProvider({
      state,
      legacy: search,
      database,
      timeoutMs: config.searchTimeoutMs,
    })
    const consolidation = new ConsolidationService({ store: state })
    const consolidationScheduler = new ConsolidationScheduler({ state, service: consolidation })
    if (config.consolidationEnabled) consolidationScheduler.start()
    lifecycle = new MemoryLifecycle({
      store: state,
      candidates: new CandidateService(state),
      buffer: new CaptureBuffer({ maxMessages: 32, maxSessionBytes: 32_000, maxMessageBytes: 2_000 }),
    })
    ctx.provide('missherMemoryCore', coordinator)
    ctx.effect(() => ctx.missherBrain.register(brainProvider), 'dsh-missher-memory: brain provider')
    new MissherMemoryRemote(ctx, coordinator)
    ctx.tools.register(
      createMemorySearchTool({
        state,
        search,
        database,
        searchTimeoutMs: config.searchTimeoutMs,
        searchByteBudget: config.searchByteBudget,
        maxSearchResults: config.maxSearchResults,
      }),
    )
    ctx.on('session/created', (session) => {
      if (session.header.cwd === undefined) return
      if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0) return
      brainProvider.noteSession(session.id, session.header.cwd)
      void coordinator.noteCwd(session.header.cwd)
    })
    ctx.on('session/event', (session, event) => {
      lifecycle?.onEvent(session, event)
    })
    ctx.on('session/disposed', (session) => {
      lifecycle?.onDisposed(session)
      brainProvider.forgetSession(session.id)
    })
    ctx.effect(
      () => async () => {
        await lifecycle?.close()
        consolidationScheduler.dispose()
        await reader?.close()
      },
      'dsh-missher-memory: dispose reader',
    )
  } catch {
    void lifecycle?.close()
    void reader?.close()
    ctx.logger.warn('dsh-missher-memory: initialization_failed')
  }
}

function resolveConfig(input: PluginConfig): ResolvedPluginConfig {
  const config: ResolvedPluginConfig = {
    enabled: input.enabled ?? true,
    captureEnabled: input.captureEnabled ?? true,
    recallEnabled: input.recallEnabled ?? true,
    consolidationEnabled: input.consolidationEnabled ?? true,
    searchTimeoutMs: input.searchTimeoutMs ?? 1_500,
    maxSearchResults: input.maxSearchResults ?? 10,
    searchByteBudget: input.searchByteBudget ?? 6_000,
    recallLimit: input.recallLimit ?? 3,
    recallByteBudget: input.recallByteBudget ?? 3_000,
  }
  assertIntegerRange('searchTimeoutMs', config.searchTimeoutMs, 100, 10_000)
  assertIntegerRange('maxSearchResults', config.maxSearchResults, 1, 10)
  assertIntegerRange('searchByteBudget', config.searchByteBudget, 1, 12_000)
  assertIntegerRange('recallLimit', config.recallLimit, 1, 5)
  assertIntegerRange('recallByteBudget', config.recallByteBudget, 1, 6_000)
  return config
}

function assertIntegerRange(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`dsh-missher-memory: invalid ${name}`)
  }
}

export default { name, inject, Config, apply }

export type * from './remote-contract.ts'
