import type { ApprovedMemory, CandidateScope } from './state-store.ts'
import type { SearchResultItem } from './budget.ts'
import { inspectPrivacy } from './privacy.ts'
import { normalizeFtsQuery } from './query-policy.ts'

/** Filters approved plugin memories with literal terms and no cross-project input. */
export function searchApprovedMemories(
  memories: readonly ApprovedMemory[],
  query: string,
  scope: CandidateScope,
): { ok: true; rows: SearchResultItem[]; rejectedSensitive: number } | { ok: false } {
  if (!normalizeFtsQuery(query).ok || !inspectPrivacy(query).safe) return { ok: false }
  const terms = literalTerms(query)
  let rejectedSensitive = 0
  const rows = memories
    .filter((memory) => memory.scope === scope)
    .flatMap((memory) => {
      if (!inspectPrivacy(memory.content).safe) {
        rejectedSensitive += 1
        return []
      }
      const lowered = memory.content.toLocaleLowerCase()
      const score = terms.reduce((count, term) => count + Number(lowered.includes(term)), 0)
      if (score === 0) return []
      return [{
        score: score + Number(memory.pinned) * 100,
        updatedAt: memory.updatedAt,
        row: {
          excerpt: memory.content,
          kind: memory.kind,
          source: scope === 'personal' ? 'approved personal memory' : 'approved project memory',
          recordedAt: memory.updatedAt,
          reference: memory.memoryId,
        } satisfies SearchResultItem,
      }]
    })
    .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    .map((entry) => entry.row)
  return { ok: true, rows, rejectedSensitive }
}

function literalTerms(query: string): string[] {
  const lowered = query.normalize('NFC').toLocaleLowerCase()
  const words = Array.from(lowered.matchAll(/[\p{L}\p{N}\p{M}_-]+/gu), (match) => match[0])
  const terms = new Set<string>()
  for (const word of words) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(word) && Array.from(word).length > 2) {
      const characters = Array.from(word)
      for (let index = 0; index < characters.length - 1; index += 1) terms.add(characters.slice(index, index + 2).join(''))
    } else if (Array.from(word).length >= 2) {
      terms.add(word)
    }
  }
  return [...terms].slice(0, 32)
}
