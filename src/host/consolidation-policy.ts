import { createHash } from 'node:crypto'
import type { CandidateKind, CandidateScope, ConsolidationAtom } from './state-store.ts'

export interface ConsolidationPolicy {
  now: number
  minimumAgeMs: number
  minimumSources: number
}

export interface ConsolidationGroup {
  projectKey: string
  scope: CandidateScope
  kind: CandidateKind
  topicKey: string
  content: string
  sourceMemoryIds: string[]
}

/** Selects only exact normalized duplicates; extractive consolidation cannot invent facts. */
export function selectConsolidationGroups(
  atoms: readonly ConsolidationAtom[],
  policy: ConsolidationPolicy,
): ConsolidationGroup[] {
  const grouped = new Map<string, ConsolidationAtom[]>()
  for (const atom of atoms) {
    const createdAt = Date.parse(atom.createdAt)
    if (atom.pinned || !Number.isFinite(createdAt) || policy.now - createdAt < policy.minimumAgeMs) continue
    const normalized = normalizeContent(atom.content)
    if (normalized === '') continue
    const key = `${atom.projectKey}\0${atom.scope}\0${atom.kind}\0${normalized}`
    const group = grouped.get(key) ?? []
    group.push(atom)
    grouped.set(key, group)
  }
  return [...grouped.entries()]
    .filter(([, group]) => group.length >= policy.minimumSources)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 6)
    .map(([key, group]) => {
      const first = group[0]!
      return {
        projectKey: first.projectKey,
        scope: first.scope,
        kind: first.kind,
        topicKey: createHash('sha256').update(key).digest('hex').slice(0, 24),
        content: first.content.trim(),
        sourceMemoryIds: group.map(atom => atom.memoryId).sort().slice(0, 24),
      }
    })
}

function normalizeContent(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}
