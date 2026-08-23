import { createHmac, randomBytes } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import type {
  BindProjectRequest,
  CandidateReviewRequest,
  DeleteProjectRequest,
  ExportProjectRequest,
  ExportProjectResult,
  MemorySnapshot,
  UpdateSettingsRequest,
} from '../remote-contract.ts'
import type { MissherMemoryRemoteBackend } from '../remote.ts'
import { inspectMemoryDatabase } from './database-status.ts'
import type { MemoryDatabasePathOptions } from './path-policy.ts'
import type { BoundProject, StateStore } from './state-store.ts'
import type { SourceDiscoveryService } from './source-discovery.ts'

interface CandidateEntry {
  cwd: string
  view: NonNullable<MemorySnapshot['projectCandidate']>
}

interface SourceEntry {
  sessionKey: string
  view: Omit<MemorySnapshot['sources'][number], 'bound'>
}

/** Inputs for one in-memory discovery and durable-state coordinator. */
export interface MemoryCoordinatorOptions {
  state: Pick<
    StateStore,
    | 'lookupProject'
    | 'bindProject'
    | 'updateSettings'
    | 'deleteProject'
    | 'editCandidate'
    | 'approveCandidate'
    | 'setCandidatePinned'
    | 'forgetCandidate'
    | 'mergeCandidates'
    | 'exportProject'
  > & Partial<Pick<StateStore, 'listProjects' | 'listCandidates' | 'listApprovedMemories'>>
  database: MemoryDatabasePathOptions
  discovery?: Pick<SourceDiscoveryService, 'discover'> | undefined
}

/** Keeps cwd and external session identifiers in Host memory behind opaque RPC handles. */
export class MemoryCoordinator implements MissherMemoryRemoteBackend {
  readonly #state: MemoryCoordinatorOptions['state']
  readonly #database: MemoryDatabasePathOptions
  readonly #discovery: MemoryCoordinatorOptions['discovery']
  readonly #discoveryKey = randomBytes(32)
  readonly #candidates = new Map<string, CandidateEntry>()
  readonly #sources = new Map<string, SourceEntry>()
  #currentCandidateId: string | undefined

  /** Creates a zero-write coordinator. */
  constructor(options: MemoryCoordinatorOptions) {
    this.#state = options.state
    this.#database = options.database
    this.#discovery = options.discovery
  }

  /**
   * Records an active top-level cwd as an in-memory binding candidate.
   *
   * @param cwd Absolute cwd from a trusted Session header.
   */
  async noteCwd(cwd: string): Promise<void> {
    let canonicalCwd: string
    try {
      canonicalCwd = await realpath(cwd)
    } catch {
      return
    }
    const digest = this.#digest('candidate', canonicalCwd)
    const candidateId = `cand_${digest.slice(0, 16)}`
    this.#candidates.set(candidateId, {
      cwd: canonicalCwd,
      view: { candidateId, basename: basename(canonicalCwd), shortHash: digest.slice(16, 24) },
    })
    this.#currentCandidateId = candidateId
    trimOldest(this.#candidates, 64)
  }

  /**
   * Adds one externally discovered session identifier behind an opaque handle.
   *
   * @param source Structural counts and times plus the Host-only session identifier.
   */
  noteSource(source: {
    sessionKey: string
    recordCount: number
    firstAt: string | null
    lastAt: string | null
  }): void {
    const digest = this.#digest('source', source.sessionKey)
    const sourceId = `src_${digest.slice(0, 16)}`
    this.#sources.set(sourceId, {
      sessionKey: source.sessionKey,
      view: {
        sourceId,
        shortHash: digest.slice(16, 24),
        recordCount: Math.max(0, Math.min(1_000_000_000, Math.floor(source.recordCount))),
        firstAt: source.firstAt,
        lastAt: source.lastAt,
      },
    })
    trimOldest(this.#sources, 200)
  }

  /** Returns the strict pathless settings snapshot. */
  async snapshot(): Promise<MemorySnapshot> {
    const database = await inspectMemoryDatabase(this.#database)
    if (database.status === 'ready' && this.#discovery !== undefined) {
      const discovered = await this.#discovery.discover()
      if (discovered.status === 'ready') {
        this.#sources.clear()
        for (const source of discovered.sources) this.noteSource(source)
      }
    }
    const candidate = this.#currentCandidateId === undefined ? undefined : this.#candidates.get(this.#currentCandidateId)
    const lookup = candidate === undefined ? { status: 'unbound' as const } : await this.#state.lookupProject(candidate.cwd)
    const project = lookup.status === 'bound' ? projectView(lookup.project) : null
    const projects = this.#state.listProjects === undefined
      ? []
      : (await this.#state.listProjects()).map((item) => ({
          projectKey: item.projectKey,
          basename: item.basename,
          shortHash: item.shortHash,
          captureEnabled: item.captureEnabled,
          recallEnabled: item.recallEnabled,
          recallLimit: item.recallLimit,
          recallByteBudget: item.recallByteBudget,
        }))
    const boundSessions = new Set(lookup.status === 'bound' ? lookup.project.sessionKeys : [])
    const candidates = lookup.status === 'bound' && this.#state.listCandidates !== undefined
      ? (await this.#state.listCandidates(lookup.project.projectKey)).map((item) => ({
          candidateId: item.candidateId,
          projectShortHash: item.projectShortHash,
          scope: item.scope,
          kind: item.kind,
          content: item.content,
          status: item.status,
          pinned: item.pinned,
          createdAt: item.createdAt,
        }))
      : []
    const approvedCount = lookup.status === 'bound' && this.#state.listApprovedMemories !== undefined
      ? (await Promise.all([
          this.#state.listApprovedMemories({ projectKey: lookup.project.projectKey, scope: 'project' }),
          this.#state.listApprovedMemories({ projectKey: lookup.project.projectKey, scope: 'personal' }),
        ])).reduce((total, rows) => total + rows.length, 0)
      : 0
    return {
      schemaVersion: 1,
      database,
      projectCandidate: candidate?.view ?? null,
      project,
      projects,
      sources: [...this.#sources.values()].map((source) => ({
        ...source.view,
        bound: boundSessions.has(source.sessionKey),
      })),
      candidates,
      approvedCount,
    }
  }

  /** Resolves opaque discovery handles and persists an explicit binding. */
  async bindProject(request: BindProjectRequest): Promise<MemorySnapshot> {
    const candidate = this.#candidates.get(request.candidateId)
    if (candidate === undefined) throw new Error('unknown_candidate')
    const sources = request.sourceIds.map((sourceId) => this.#sources.get(sourceId))
    if (sources.some((source) => source === undefined)) throw new Error('unknown_source')
    const result = await this.#state.bindProject({
      cwd: candidate.cwd,
      sessionKeys: sources.map((source) => source!.sessionKey),
      ...(request.existingProjectKey === undefined ? {} : { projectKey: request.existingProjectKey }),
    })
    if (result.status !== 'bound') throw new Error(`bind_${result.status}`)
    return this.snapshot()
  }

  /** Applies an explicit project settings action. */
  async updateSettings(request: UpdateSettingsRequest): Promise<MemorySnapshot> {
    const { projectKey, ...patch } = request
    const result = await this.#state.updateSettings(projectKey, patch)
    if (result.status !== 'updated') throw new Error(`settings_${result.status}`)
    return this.snapshot()
  }

  /** Deletes only plugin-owned project rows after Remote validation. */
  async deleteProject(request: DeleteProjectRequest): Promise<MemorySnapshot> {
    const result = await this.#state.deleteProject(request.projectKey)
    if (result.status !== 'deleted') throw new Error(`delete_${result.status}`)
    return this.snapshot()
  }

  /** Applies an explicit inbox review mutation and refreshes the safe snapshot. */
  async reviewCandidate(request: CandidateReviewRequest): Promise<MemorySnapshot> {
    let status: string
    if (request.action === 'edit') {
      const { candidateId } = request
      const patch = {
        content: request.content,
        ...(request.scope === undefined ? {} : { scope: request.scope }),
        ...(request.kind === undefined ? {} : { kind: request.kind }),
      }
      status = (await this.#state.editCandidate(candidateId, patch)).status
      if (status !== 'updated') throw new Error(`candidate_${status}`)
    } else if (request.action === 'approve') {
      const { candidateId } = request
      const patch = {
        ...(request.content === undefined ? {} : { content: request.content }),
        ...(request.scope === undefined ? {} : { scope: request.scope }),
        ...(request.kind === undefined ? {} : { kind: request.kind }),
      }
      status = (await this.#state.approveCandidate(candidateId, patch)).status
      if (status !== 'approved') throw new Error(`candidate_${status}`)
    } else if (request.action === 'pin') {
      status = (await this.#state.setCandidatePinned(request.candidateId, request.pinned)).status
      if (status !== 'updated') throw new Error(`candidate_${status}`)
    } else if (request.action === 'forget') {
      status = (await this.#state.forgetCandidate(request.candidateId)).status
      if (status !== 'forgotten') throw new Error(`candidate_${status}`)
    } else {
      status = (await this.#state.mergeCandidates(request.candidateIds, {
        scope: request.scope,
        kind: request.kind,
        content: request.content,
      })).status
      if (status !== 'merged') throw new Error(`candidate_${status}`)
    }
    return this.snapshot()
  }

  /** Serializes one project export without cwd, source session identities, or filesystem paths. */
  async exportProject(request: ExportProjectRequest): Promise<ExportProjectResult> {
    const result = await this.#state.exportProject(request.projectKey)
    if (result.status !== 'exported') throw new Error(`export_${result.status}`)
    const stem = `${result.project.basename}-${result.project.shortHash}`
      .replace(/[^a-zA-Z0-9._-]+/gu, '-')
      .slice(0, 100)
    return {
      fileName: `missher-memory-${stem || result.project.shortHash}.json`,
      content: JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...result }, null, 2),
    }
  }

  #digest(domain: 'candidate' | 'source', value: string): string {
    return createHmac('sha256', this.#discoveryKey).update(`missher-memory:${domain}\0`).update(value).digest('hex')
  }
}

function projectView(project: BoundProject): NonNullable<MemorySnapshot['project']> {
  return {
    projectKey: project.projectKey,
    basename: project.basename,
    shortHash: project.shortHash,
    captureEnabled: project.captureEnabled,
    recallEnabled: project.recallEnabled,
    recallLimit: project.recallLimit,
    recallByteBudget: project.recallByteBudget,
  }
}

function trimOldest<T>(entries: Map<string, T>, limit: number): void {
  while (entries.size > limit) {
    const oldest = entries.keys().next().value as string | undefined
    if (oldest === undefined) return
    entries.delete(oldest)
  }
}
