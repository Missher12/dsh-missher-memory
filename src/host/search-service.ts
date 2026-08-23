import { createHash } from 'node:crypto'
import type { MemoryDatabasePathOptions } from './path-policy.ts'
import { resolveMemoryDatabase } from './path-policy.ts'
import { applySearchBudget, type SearchResultItem } from './budget.ts'
import { inspectPrivacy } from './privacy.ts'
import { normalizeFtsQuery } from './query-policy.ts'
import type { ReaderWorker } from './reader-worker.ts'

/** Inputs for one project-scoped external memory search. */
export interface MemorySearchRequest {
  database: MemoryDatabasePathOptions
  sessionKeys: readonly string[]
  query: string
  limit: number
  maxBytes: number
  timeoutMs: number
}

/** Safe public result from an external memory search. */
export type MemorySearchResult =
  | { status: 'project-unbound' | 'invalid-query' | 'not-configured' | 'unsafe-path' | 'timeout' | 'corrupt' | 'incompatible' | 'unavailable' }
  | {
      status: 'ready'
      results: SearchResultItem[]
      truncated: boolean
      usedBytes: number
      rejectedSensitive: number
    }

/** Executes privacy-filtered project searches through a deadline-controlled reader. */
export class MemorySearchService {
  /**
   * Creates a search service over the supplied Worker owner.
   *
   * @param reader Read-only SQLite Worker owner.
   */
  constructor(private readonly reader: Pick<ReaderWorker, 'read'>) {}

  /**
   * Searches only records authorized by explicit project session mappings.
   *
   * @param request Query, project mappings, path inputs, and lower budgets.
   * @returns Public rows or a path-free failure state.
   */
  async search(request: MemorySearchRequest): Promise<MemorySearchResult> {
    if (request.sessionKeys.length === 0) return { status: 'project-unbound' }
    const query = normalizeFtsQuery(request.query)
    if (!query.ok) return { status: 'invalid-query' }
    const database = await resolveMemoryDatabase(request.database)
    if (!database.ok) return { status: database.code }

    const limit = Math.max(1, Math.min(10, Math.floor(request.limit)))
    const result = await this.reader.read(
      {
        databasePath: database.databasePath,
        ftsQuery: query.normalized,
        sessionKeys: request.sessionKeys,
        limit: Math.min(20, limit * 2),
      },
      request.timeoutMs,
    )
    if (result.status !== 'ok') return result

    let rejectedSensitive = 0
    const safeRows: SearchResultItem[] = []
    for (const row of result.rows) {
      if (!inspectPrivacy(row.excerpt).safe) {
        rejectedSensitive += 1
        continue
      }
      safeRows.push({
        excerpt: row.excerpt,
        kind: row.kind,
        source: row.source,
        recordedAt: row.recordedAt,
        reference: stableReference(row.source, row.recordId),
      })
    }
    const budget = applySearchBudget(safeRows, { maxResults: limit, maxBytes: request.maxBytes })
    return { status: 'ready', ...budget, rejectedSensitive }
  }
}

function stableReference(source: string, recordId: string): string {
  return `mem_${createHash('sha256').update(source).update('\0').update(recordId).digest('hex').slice(0, 16)}`
}
