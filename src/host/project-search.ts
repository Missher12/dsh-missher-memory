import type { MemoryDatabasePathOptions } from './path-policy.ts'
import type { MemorySearchService } from './search-service.ts'
import type { StateStore } from './state-store.ts'
import { inspectPrivacy } from './privacy.ts'
import { applySearchBudget } from './budget.ts'
import { searchApprovedMemories } from './approved-search.ts'

export const TOOL_STATUSES = [
  'ready',
  'caller-required',
  'project-unbound',
  'invalid-query',
  'not-configured',
  'unsafe-path',
  'timeout',
  'corrupt',
  'incompatible',
  'unavailable',
] as const

/** Canonical JSON value returned by `memory_search`. */
export interface MemoryToolValue {
  status: (typeof TOOL_STATUSES)[number]
  scope: 'project' | 'personal'
  project: { basename: string; shortHash: string } | null
  results: Array<{
    excerpt: string
    kind: string
    source: string
    recordedAt: string | null
    reference: string
  }>
  truncated: boolean
  usedBytes: number
  rejectedSensitive: number
}

/** Dependencies and deployment tunables for `memory_search`. */
export interface MemorySearchToolOptions {
  state: Pick<StateStore, 'lookupProject'>
    & Partial<Pick<StateStore, 'listApprovedMemories' | 'searchApprovedMemories' | 'searchMemoryCapsules'>>
  search: Pick<MemorySearchService, 'search'>
  database: MemoryDatabasePathOptions
  searchTimeoutMs: number
  searchByteBudget: number
  maxSearchResults?: number | undefined
}

/** Arguments accepted by the shared project search operation. */
export interface MemorySearchArgs {
  query: string
  limit?: number | undefined
  scope?: 'project' | 'personal' | undefined
}

/** Shared search used by Cordis services and Harness tools; cwd is supplied by a trusted host. */
export async function searchProjectMemory(
  options: MemorySearchToolOptions, args: MemorySearchArgs, cwd?: string,
): Promise<MemoryToolValue> {
  if (typeof args.query !== 'string' || (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10))
    || (args.scope !== undefined && args.scope !== 'project' && args.scope !== 'personal')) {
    return emptyValue('invalid-query', 'project', null)
  }
  try {
    const scope = args.scope ?? 'project'
    if (cwd === undefined) return emptyValue('caller-required', scope, null)
    const lookup = await options.state.lookupProject(cwd)
    if (lookup.status !== 'bound') {
      return emptyValue(lookup.status === 'unbound' ? 'project-unbound' : 'unavailable', scope, null)
    }
    const project = { basename: lookup.project.basename, shortHash: lookup.project.shortHash }
    const limit = Math.min(options.maxSearchResults ?? 10, args.limit ?? 5)
    const validation = searchApprovedMemories([], args.query, scope)
    if (!validation.ok) return emptyValue('invalid-query', scope, project)
    const approved = options.state.searchApprovedMemories !== undefined
      ? await options.state.searchApprovedMemories({
          projectKey: lookup.project.projectKey,
          scope,
          query: args.query,
          limit,
        })
      : options.state.listApprovedMemories === undefined
        ? []
        : await options.state.listApprovedMemories({ projectKey: lookup.project.projectKey, scope })
    const local = searchApprovedMemories(approved, args.query, scope)
    if (!local.ok) return emptyValue('invalid-query', scope, project)
    if (scope === 'personal') {
      const budget = applySearchBudget(local.rows, { maxResults: limit, maxBytes: options.searchByteBudget })
      return { status: 'ready', scope, project, ...budget, rejectedSensitive: local.rejectedSensitive }
    }
    const capsules = await options.state.searchMemoryCapsules?.({
      projectKey: lookup.project.projectKey, query: args.query, limit,
    }) ?? []
    for (const capsule of capsules) {
      if (!inspectPrivacy(capsule.content).safe) {
        local.rejectedSensitive += 1
        continue
      }
      local.rows.push({
        excerpt: capsule.content, kind: capsule.kind, source: 'reviewed memory capsule',
        recordedAt: capsule.updatedAt, reference: capsule.capsuleId,
      })
    }
    if (lookup.project.sessionKeys.length === 0) {
      const budget = applySearchBudget(local.rows, { maxResults: limit, maxBytes: options.searchByteBudget })
      return { status: 'ready', scope, project, ...budget, rejectedSensitive: local.rejectedSensitive }
    }
    const result = await options.search.search({
      database: options.database,
      sessionKeys: lookup.project.sessionKeys,
      query: args.query,
      limit,
      maxBytes: options.searchByteBudget,
      timeoutMs: options.searchTimeoutMs,
    })
    if (result.status !== 'ready') {
      if (local.rows.length === 0) return emptyValue(result.status, scope, project)
      const budget = applySearchBudget(local.rows, { maxResults: limit, maxBytes: options.searchByteBudget })
      return { status: 'ready', scope, project, ...budget, rejectedSensitive: local.rejectedSensitive }
    }
    const budget = applySearchBudget([...local.rows, ...result.results], {
      maxResults: limit,
      maxBytes: options.searchByteBudget,
    })
    return {
      status: 'ready',
      scope,
      project,
      ...budget,
      truncated: budget.truncated || result.truncated,
      rejectedSensitive: local.rejectedSensitive + result.rejectedSensitive,
    }
  } catch {
    return emptyValue('unavailable', args.scope ?? 'project', null)
  }
}

function emptyValue(
  status: Exclude<MemoryToolValue['status'], 'ready'> | 'ready',
  scope: MemoryToolValue['scope'],
  project: MemoryToolValue['project'],
): MemoryToolValue {
  return { status, scope, project, results: [], truncated: false, usedBytes: 0, rejectedSensitive: 0 }
}
