import { isAbsolute } from 'node:path'
import { MemoryService } from './host/memory-service.ts'
import type { MemoryServiceOptions } from './host/memory-service.ts'

export { MemoryService } from './host/memory-service.ts'
export type { MemoryServiceOptions, MemoryProject, MemoryProjectAdmin } from './host/memory-service.ts'
export type { CandidateDraft, CandidateKind, CandidateRecord } from './host/state-store.ts'
export type { MemorySearchArgs, MemoryToolValue } from './host/project-search.ts'

/** The common Cordis contract; no framework package is imported at runtime. */
export interface MemoryContext {
  provide(name: string, value: unknown): unknown
  effect(callback: () => () => Promise<void>): unknown
}

export const name = 'missher-memory-service'

/** Loads the reusable service without tools, sessions, Desktop, or Brain. */
export function apply(ctx: MemoryContext, options: MemoryServiceOptions): void {
  if (options === undefined || typeof options.stateDirectory !== 'string' || !isAbsolute(options.stateDirectory)) {
    throw new TypeError('missher-memory: absolute stateDirectory required')
  }
  const service = new MemoryService(options)
  ctx.effect(() => () => service.close())
  ctx.provide('missherMemoryService', service)
}

/** Retrieves the typed service from a Cordis context with a declared dependency. */
export function getMemoryService(ctx: { get(name: string): unknown }): MemoryService {
  const service = ctx.get('missherMemoryService')
  if (!(service instanceof MemoryService)) throw new Error('missher-memory: service unavailable')
  return service
}

export default { name, apply }
