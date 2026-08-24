import type { MemoryDatabasePathOptions } from './path-policy.ts'
import { inspectPrivacy } from './privacy.ts'
import type { MemorySearchService } from './search-service.ts'
import type { ApprovedMemory, MemoryCapsule, StateStore } from './state-store.ts'

export interface MemoryBrainContribution {
  handle: string
  providerId: string
  kind: 'reviewed-memory' | 'memory-capsule' | 'legacy-memory'
  text: string
  reference: string
  recordedAt: string
  score: number
  pinned: boolean
}

export interface MemoryPreparedBatch {
  readonly items: readonly MemoryBrainContribution[]
  accept(handles: readonly string[]): Promise<void>
  cancel(): Promise<void>
}

export interface MemoryBrainInput {
  projectKey: string
  sessionId: string
  turn: number
  query: string
  signal: AbortSignal
}

export interface MemoryBrainProviderLike {
  readonly protocolVersion: 1
  readonly id: string
  readonly byteBudget: number
  prepare(input: MemoryBrainInput): Promise<MemoryPreparedBatch>
  status(): Promise<{ state: 'ready' | 'disabled' | 'unavailable'; count: number }>
}

export interface MemoryBrainHubLike {
  register(provider: MemoryBrainProviderLike): () => void
}

interface MemoryBrainProviderOptions {
  state: Pick<
    StateStore,
    'lookupProject' | 'searchApprovedMemories' | 'searchMemoryCapsules' | 'countApprovedMemories'
  >
  legacy: Pick<MemorySearchService, 'search'>
  database: MemoryDatabasePathOptions
  timeoutMs: number
}

/** Factual-memory provider; all durable mutations remain explicit user actions. */
export class MemoryBrainProvider implements MemoryBrainProviderLike {
  readonly protocolVersion = 1 as const
  readonly id = 'memory'
  readonly byteBudget = 3_000
  readonly #options: MemoryBrainProviderOptions
  readonly #sessions = new Map<string, string>()

  constructor(options: MemoryBrainProviderOptions) {
    this.#options = options
  }

  /** Records one trusted top-level Session cwd in memory only. */
  noteSession(sessionId: string, cwd: string): void {
    this.#sessions.set(sessionId, cwd)
    while (this.#sessions.size > 1_024) {
      const first = this.#sessions.keys().next().value as string | undefined
      if (first === undefined) break
      this.#sessions.delete(first)
    }
  }

  /** Drops the transient cwd mapping when Harness disposes the Session. */
  forgetSession(sessionId: string): void {
    this.#sessions.delete(sessionId)
  }

  async prepare(input: MemoryBrainInput): Promise<MemoryPreparedBatch> {
    const cwd = this.#sessions.get(input.sessionId)
    if (cwd === undefined || !inspectPrivacy(input.query).safe) return preparedBatch([])
    input.signal.throwIfAborted()
    const lookup = await this.#options.state.lookupProject(cwd)
    if (lookup.status !== 'bound' || !lookup.project.recallEnabled) return preparedBatch([])
    const limit = lookup.project.recallLimit
    const [project, personal, capsules, legacy] = await Promise.all([
      this.#options.state.searchApprovedMemories({
        projectKey: lookup.project.projectKey,
        scope: 'project',
        query: input.query,
        limit,
      }),
      this.#options.state.searchApprovedMemories({
        projectKey: lookup.project.projectKey,
        scope: 'personal',
        query: input.query,
        limit,
      }),
      this.#options.state.searchMemoryCapsules({
        projectKey: lookup.project.projectKey,
        query: input.query,
        limit,
      }),
      this.#options.legacy.search({
        database: this.#options.database,
        sessionKeys: lookup.project.sessionKeys,
        query: input.query,
        limit,
        maxBytes: lookup.project.recallByteBudget,
        timeoutMs: this.#options.timeoutMs,
      }),
    ])
    input.signal.throwIfAborted()
    const reviewed = [...project, ...personal].map(reviewedContribution)
    const capsuleItems = capsules.map(capsuleContribution)
    const legacyItems = legacy.status === 'ready'
      ? legacy.results.map(row => ({
          handle: row.reference,
          providerId: this.id,
          kind: 'legacy-memory' as const,
          text: row.excerpt,
          reference: row.reference,
          recordedAt: row.recordedAt ?? '',
          score: 0,
          pinned: false,
        }))
      : []
    return preparedBatch([...reviewed, ...capsuleItems, ...legacyItems])
  }

  async status(): Promise<{ state: 'ready' | 'disabled' | 'unavailable'; count: number }> {
    try {
      return { state: 'ready', count: await this.#options.state.countApprovedMemories() }
    } catch {
      return { state: 'unavailable', count: 0 }
    }
  }
}

function reviewedContribution(memory: ApprovedMemory): MemoryBrainContribution {
  return {
    handle: memory.memoryId,
    providerId: 'memory',
    kind: 'reviewed-memory',
    text: memory.content,
    reference: memory.memoryId,
    recordedAt: memory.updatedAt,
    score: 1,
    pinned: memory.pinned,
  }
}

function capsuleContribution(capsule: MemoryCapsule): MemoryBrainContribution {
  return {
    handle: capsule.capsuleId,
    providerId: 'memory',
    kind: 'memory-capsule',
    text: capsule.content,
    reference: capsule.capsuleId,
    recordedAt: capsule.updatedAt,
    score: 1.5,
    pinned: false,
  }
}

function preparedBatch(items: readonly MemoryBrainContribution[]): MemoryPreparedBatch {
  const offered = new Set(items.map(item => item.handle))
  let settled = false
  return {
    items,
    accept: async handles => {
      if (settled) throw new Error('brain_batch_settled')
      if (
        handles.length === 0
        || new Set(handles).size !== handles.length
        || handles.some(handle => !offered.has(handle))
      ) throw new Error('brain_handles_invalid')
      settled = true
    },
    cancel: async () => { settled = true },
  }
}
