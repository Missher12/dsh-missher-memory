import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tools'
import memoryCore, { type MemoryService } from './core.ts'
import harnessAdapter from './host/harness-adapter.ts'
import type { MemoryBrainHubLike } from './host/brain-provider.ts'
import type { MemoryCoordinator } from './host/coordinator.ts'

/** Cordis plugin identifier. */
export const name = 'missher-memory'

/** Harness services required by the Host face. */
export const inject = ['dshHomePath']

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

export interface ResolvedPluginConfig {
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
    missherMemoryService: MemoryService
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
export async function apply(ctx: Context, input: PluginConfig = {}): Promise<void> {
  const config = resolveConfig(input)
  if (!config.enabled) return
  await ctx.plugin(memoryCore, {
    stateDirectory: ctx.dshHomePath('missher-memory'),
    defaultCaptureEnabled: config.captureEnabled,
    defaultRecallEnabled: config.recallEnabled,
    defaultRecallLimit: config.recallLimit,
    defaultRecallByteBudget: config.recallByteBudget,
    legacyDatabaseDirectory: process.env.MISSHER_TENCENTDB_DIR,
    searchTimeoutMs: config.searchTimeoutMs,
    searchByteBudget: config.searchByteBudget,
    maxSearchResults: config.maxSearchResults,
  })
  // tools and Brain wait in child adapters, independently from the core service.
  await ctx.plugin(harnessAdapter, config)
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
