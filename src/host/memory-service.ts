import { isAbsolute } from 'node:path'
import { StateStore, type CandidateDraft, type StateStoreOptions } from './state-store.ts'
import { ReaderWorker } from './reader-worker.ts'
import { MemorySearchService } from './search-service.ts'
import { searchProjectMemory, type MemorySearchArgs } from './project-search.ts'
import { inspectPrivacy } from './privacy.ts'
import { truncateUtf8 } from './budget.ts'
import type { MemoryDatabasePathOptions } from './path-policy.ts'

export interface MemoryServiceOptions extends StateStoreOptions {
  legacyDatabaseDirectory?: string | undefined
  searchTimeoutMs?: number | undefined
  searchByteBudget?: number | undefined
  maxSearchResults?: number | undefined
}

const KINDS = new Set(['architecture', 'decision', 'progress', 'failure', 'next', 'project-preference', 'personal-preference'])

/** Internal adapter dependencies, never registered as Agent tools. */
interface MemoryRuntime {
  state: StateStore
  reader: ReaderWorker
  search: MemorySearchService
  database: MemoryDatabasePathOptions
  searchTimeoutMs: number
  searchByteBudget: number
  maxSearchResults: number
}

const runtimes = new WeakMap<MemoryService, MemoryRuntime>()

/** Package-internal bridge for the Harness adapter. */
export function memoryRuntime(service: MemoryService): MemoryRuntime {
  const runtime = runtimes.get(service)
  if (runtime === undefined) throw new Error('missher-memory: unknown service')
  return runtime
}

/** Trusted-host service. Only a project facade should be mapped to Agent tools. */
export class MemoryService {
  readonly #runtime: MemoryRuntime
  #closed = false
  #queue: Promise<unknown> = Promise.resolve()
  #closing: Promise<void> | undefined

  constructor(options: MemoryServiceOptions) {
    if (typeof options.stateDirectory !== 'string' || !isAbsolute(options.stateDirectory)) {
      throw new TypeError('missher-memory: absolute stateDirectory required')
    }
    if (options.legacyDatabaseDirectory !== undefined && !isAbsolute(options.legacyDatabaseDirectory)) {
      throw new TypeError('missher-memory: absolute legacyDatabaseDirectory required')
    }
    const searchTimeoutMs = integerOption(options.searchTimeoutMs, 1_500, 100, 10_000)
    const searchByteBudget = integerOption(options.searchByteBudget, 6_000, 1, 12_000)
    const maxSearchResults = integerOption(options.maxSearchResults, 10, 1, 10)
    integerOption(options.defaultRecallLimit, 3, 1, 5)
    integerOption(options.defaultRecallByteBudget, 3_000, 1, 6_000)
    for (const value of [options.defaultCaptureEnabled, options.defaultRecallEnabled]) {
      if (value !== undefined && typeof value !== 'boolean') throw new TypeError('missher-memory: invalid configuration')
    }
    const reader = new ReaderWorker()
    this.#runtime = {
      state: new StateStore(options), reader, search: new MemorySearchService(reader),
      database: options.legacyDatabaseDirectory === undefined ? {} : { overrideRoot: options.legacyDatabaseDirectory },
      searchTimeoutMs, searchByteBudget, maxSearchResults,
    }
    runtimes.set(this, this.#runtime)
  }

  /** Path-free readiness check that does not initialize state. */
  status() {
    return this.#run(async () => ({
      status: 'ready' as const, protocolVersion: 1 as const, supportedSchemaVersion: 2,
      hasState: await this.#runtime.state.hasState(),
      capabilities: { search: true, get: true, propose: true, requiresReview: true, automaticCapture: false, automaticRecall: false },
    }))
  }

  /** Explicit operator action; never infer a binding from model-supplied paths. */
  bindProject(input: Parameters<StateStore['bindProject']>[0]) {
    const snapshot = { ...input, sessionKeys: [...input.sessionKeys] }
    return this.#run(() => this.#runtime.state.bindProject(snapshot))
  }

  /** Freezes one trusted project context, with no shared mutable current-project state. */
  project(cwd: string, options: { allowPersonal?: boolean } = {}) {
    if (!isAbsolute(cwd)) throw new TypeError('missher-memory: absolute project cwd required')
    const allowPersonal = options.allowPersonal === true
    return Object.freeze({
      status: () => this.#run(async () => {
        const result = await this.#runtime.state.lookupProject(cwd)
        if (result.status !== 'bound') return { status: result.status }
        return { status: 'bound' as const, project: { basename: result.project.basename, shortHash: result.project.shortHash } }
      }),
      search: (args: MemorySearchArgs) => {
        const snapshot = { ...args }
        return this.#run(async () => {
          if (snapshot.scope === 'personal' && !allowPersonal) return { status: 'scope-denied' as const }
          return searchProjectMemory(this.#runtime, snapshot, cwd)
        })
      },
      get: (reference: string, scope: 'project' | 'personal' = 'project') => this.#run(async () => {
        if (typeof reference !== 'string' || reference.length > 128 || !['project', 'personal'].includes(scope)) return { status: 'invalid-input' as const }
        if (scope === 'personal' && !allowPersonal) return { status: 'scope-denied' as const }
        const lookup = await this.#runtime.state.lookupProject(cwd)
        if (lookup.status !== 'bound') return { status: lookup.status }
        const result = await this.#runtime.state.getReviewedMemory({ projectKey: lookup.project.projectKey, scope, reference })
        if (result.status !== 'ready') return result
        if (!inspectPrivacy(result.memory.content).safe) return { status: 'rejected-sensitive' as const }
        const content = truncateUtf8(result.memory.content, this.#runtime.searchByteBudget)
        return { status: 'ready' as const, memory: {
          ...result.memory, content: content.text, sourceReferences: result.memory.sourceReferences.slice(0, 32),
        }, truncated: content.truncated || result.memory.sourceReferences.length > 32, usedBytes: content.bytes }
      }),
      propose: (input: { sourceId: string; drafts: readonly CandidateDraft[] }) => {
        // Snapshot inputs before entering the queue; the caller cannot change the project or draft mid-flight.
        const sourceId = input.sourceId
        const drafts = input.drafts.map(draft => ({ ...draft }))
        return this.#run(async () => {
          if (typeof sourceId !== 'string' || sourceId.length < 1 || sourceId.length > 512
            || /[\u0000-\u001f\u007f]/u.test(sourceId) || drafts.length < 1 || drafts.length > 8) {
            return { status: 'invalid-input' as const }
          }
          if (drafts.some(draft => !KINDS.has(draft.kind) || !['project', 'personal'].includes(draft.scope)
            || typeof draft.content !== 'string' || Buffer.byteLength(draft.content, 'utf8') > 2_000)) {
            return { status: 'invalid-input' as const }
          }
          if (drafts.some(draft => draft.scope === 'personal') && !allowPersonal) return { status: 'scope-denied' as const }
          if (drafts.some(draft => !inspectPrivacy(draft.content).safe)) return { status: 'rejected-sensitive' as const }
          const lookup = await this.#runtime.state.lookupProject(cwd)
          if (lookup.status !== 'bound') return { status: lookup.status }
          return this.#runtime.state.createPendingCandidates(lookup.project.projectKey, sourceId, drafts)
        })
      },
    })
  }

  /** Operator-only review surface. Do not expose this object to a model. */
  admin(cwd: string) {
    if (!isAbsolute(cwd)) throw new TypeError('missher-memory: absolute project cwd required')
    const scoped = <T>(action: (projectKey: string) => Promise<T>) => this.#run(async () => {
      const lookup = await this.#runtime.state.lookupProject(cwd)
      if (lookup.status !== 'bound') return { status: lookup.status }
      return action(lookup.project.projectKey)
    })
    return Object.freeze({
      candidates: () => scoped(async projectKey => ({ status: 'ready' as const, candidates: await this.#runtime.state.listCandidates(projectKey) })),
      approve: (candidateId: string) => scoped(projectKey => this.#runtime.state.approveCandidate(candidateId, {}, projectKey)),
      forget: (candidateId: string) => scoped(projectKey => this.#runtime.state.forgetCandidate(candidateId, projectKey)),
    })
  }

  /** Refuses new work, drains accepted calls, and releases the lazy external reader. */
  close(): Promise<void> {
    this.#closed = true
    return this.#closing ??= this.#queue.then(() => this.#runtime.reader.close())
  }

  #run<T>(action: () => Promise<T>): Promise<T | { status: 'unavailable' }> {
    if (this.#closed) return Promise.resolve({ status: 'unavailable' })
    const operation = this.#queue.then(action).catch(() => ({ status: 'unavailable' as const }))
    this.#queue = operation
    return operation
  }
}

export type MemoryProject = ReturnType<MemoryService['project']>
export type MemoryProjectAdmin = ReturnType<MemoryService['admin']>

function integerOption(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  const resolved = value ?? fallback
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) throw new TypeError('missher-memory: invalid configuration')
  return resolved
}
