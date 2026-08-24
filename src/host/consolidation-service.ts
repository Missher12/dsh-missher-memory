import { selectConsolidationGroups } from './consolidation-policy.ts'
import type { StateStore } from './state-store.ts'

export interface ConsolidationServiceOptions {
  store: Pick<StateStore, 'listConsolidationAtoms' | 'commitCapsule' | 'recordMaintenanceRun'>
  now?: () => number
}

export type ConsolidationResult =
  | { status: 'no-op' | 'unavailable'; inputCount: number; outputCount: 0 }
  | { status: 'consolidated'; inputCount: number; outputCount: number; capsuleIds: string[] }

/** Bounded deterministic consolidation for old exact duplicate reviewed atoms. */
export class ConsolidationService {
  readonly #store: ConsolidationServiceOptions['store']
  readonly #now: () => number

  constructor(options: ConsolidationServiceOptions) {
    this.#store = options.store
    this.#now = options.now ?? Date.now
  }

  async runProject(projectKey: string, trigger: 'automatic' | 'manual'): Promise<ConsolidationResult> {
    const startedAt = new Date(this.#now()).toISOString()
    try {
      const atoms = await this.#store.listConsolidationAtoms(projectKey)
      const groups = selectConsolidationGroups(atoms, {
        now: this.#now(),
        minimumAgeMs: 7 * 86_400_000,
        minimumSources: 4,
      })
      const capsuleIds: string[] = []
      let inputCount = 0
      for (const group of groups) {
        const committed = await this.#store.commitCapsule({ ...group, policyVersion: 1 })
        if (committed.status !== 'consolidated') continue
        capsuleIds.push(committed.capsuleId)
        inputCount += group.sourceMemoryIds.length
      }
      const status = capsuleIds.length === 0 ? 'no-op' as const : 'consolidated' as const
      await this.#store.recordMaintenanceRun({
        projectKey,
        trigger,
        result: status,
        inputCount,
        outputCount: capsuleIds.length,
        startedAt,
        finishedAt: new Date(this.#now()).toISOString(),
      })
      return status === 'no-op'
        ? { status, inputCount: 0, outputCount: 0 }
        : { status, inputCount, outputCount: capsuleIds.length, capsuleIds }
    } catch {
      return { status: 'unavailable', inputCount: 0, outputCount: 0 }
    }
  }
}
