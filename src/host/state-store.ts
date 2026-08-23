import { createHmac, randomBytes } from 'node:crypto'
import { lstat, chmod, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  decryptSessionKey,
  encryptSessionKey,
  hashSessionKey,
  keyFingerprint,
  loadLocalKey,
  loadOrCreateLocalKey,
} from './local-key.ts'
import { deriveProjectIdentity } from './project-identity.ts'
import { truncateUtf8 } from './budget.ts'
import { inspectPrivacy } from './privacy.ts'

const STATE_SCHEMA_VERSION = 1

/** Project information used internally by Host services. */
export interface BoundProject {
  projectKey: string
  basename: string
  shortHash: string
  captureEnabled: boolean
  recallEnabled: boolean
  recallLimit: number
  recallByteBudget: number
  sessionKeys: string[]
}

/** Project fields safe for settings listings. */
export type ProjectSummary = Omit<BoundProject, 'sessionKeys'>

/** Construction options for the lazy state store. */
export interface StateStoreOptions {
  stateDirectory: string
  defaultRecallLimit?: number | undefined
  defaultRecallByteBudget?: number | undefined
}

/** Result returned by project lookup. */
export type ProjectLookupResult =
  | { status: 'bound'; project: BoundProject }
  | { status: 'unbound' | 'corrupt' | 'incompatible-state' | 'unsafe-state' | 'unavailable' }

type MutationFailure = { status: 'unknown-project' | 'alias-conflict' | 'corrupt' | 'incompatible-state' | 'unsafe-state' | 'unavailable' }

export type CandidateScope = 'project' | 'personal'
export type CandidateKind =
  | 'architecture'
  | 'decision'
  | 'progress'
  | 'failure'
  | 'next'
  | 'project-preference'
  | 'personal-preference'

export interface CandidateDraft {
  scope: CandidateScope
  kind: CandidateKind
  content: string
}

export interface CandidateRecord extends CandidateDraft {
  candidateId: string
  projectShortHash: string
  status: 'pending' | 'approved' | 'forgotten'
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export interface ApprovedMemory extends CandidateDraft {
  memoryId: string
  projectShortHash?: string | undefined
  sourceCandidateIds: string[]
  pinned: boolean
  createdAt: string
  updatedAt: string
}

interface CandidateRow {
  candidate_id: string
  project_key: string
  project_short_hash: string
  scope: CandidateScope
  kind: CandidateKind
  content: string
  status: 'pending' | 'approved' | 'forgotten'
  pinned: number
  created_at: string
  updated_at: string
}

interface ApprovedMemoryRow {
  memory_id: string
  project_short_hash: string | null
  scope: CandidateScope
  kind: CandidateKind
  content: string
  sources_json: string
  pinned: number
  created_at: string
  updated_at: string
}

interface ProjectRow {
  project_key: string
  basename: string
  short_hash: string
  capture_enabled: number
  recall_enabled: number
  recall_limit: number
  recall_byte_budget: number
}

interface BindingRow {
  session_ciphertext: string
}

/** Lazy plugin-owned SQLite state that writes only after explicit user actions. */
export class StateStore {
  readonly #stateDirectory: string
  readonly #databasePath: string
  readonly #defaultRecallLimit: number
  readonly #defaultRecallByteBudget: number

  /**
   * Creates a path-only store object without touching the filesystem.
   *
   * @param options Absolute state directory selected by the Host.
   */
  constructor(options: StateStoreOptions) {
    this.#stateDirectory = options.stateDirectory
    this.#databasePath = join(options.stateDirectory, 'state.db')
    this.#defaultRecallLimit = options.defaultRecallLimit ?? 3
    this.#defaultRecallByteBudget = options.defaultRecallByteBudget ?? 3_000
  }

  /** Returns whether an existing safe state database is present without creating it. */
  async hasState(): Promise<boolean> {
    return (await this.#inspectStateDatabase()).status === 'present'
  }

  /**
   * Finds the user-confirmed project for a cwd alias without persisting the cwd.
   *
   * @param cwd Current session cwd candidate.
   * @returns Bound project and decrypted source keys or a safe state.
   */
  async lookupProject(cwd: string): Promise<ProjectLookupResult> {
    const state = await this.#inspectStateDatabase()
    if (state.status === 'missing') return { status: 'unbound' }
    if (state.status !== 'present') return { status: state.status }
    const canonicalCwd = await canonicalizeCwd(cwd)
    if (canonicalCwd === undefined) return { status: 'unavailable' }
    const key = await loadLocalKey(this.#stateDirectory)
    if (key.status !== 'ready') return { status: key.status === 'unsafe-state' ? 'unsafe-state' : 'corrupt' }

    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.#databasePath, { readOnly: true, allowExtension: false, timeout: 250 })
      const schema = validateSchema(database)
      if (schema !== 'ready') return { status: schema }
      if (!validateKey(database, key.key)) return { status: 'corrupt' }
      const identity = deriveProjectIdentity(canonicalCwd, key.key)
      const row = database
        .prepare(`
          SELECT p.project_key, p.basename, p.short_hash, s.capture_enabled, s.recall_enabled,
                 s.recall_limit, s.recall_byte_budget
          FROM project_aliases AS a
          INNER JOIN projects AS p ON p.project_key = a.project_key
          INNER JOIN settings AS s ON s.project_key = p.project_key
          WHERE a.alias_hash = ?
        `)
        .get(identity.aliasHash) as unknown as ProjectRow | undefined
      if (row === undefined) return { status: 'unbound' }
      const bindings = database
        .prepare('SELECT session_ciphertext FROM bindings WHERE project_key = ? ORDER BY created_at, session_hash')
        .all(row.project_key) as unknown as BindingRow[]
      const sessionKeys = bindings.map((binding) => decryptSessionKey(key.key, binding.session_ciphertext))
      return { status: 'bound', project: projectFromRow(row, sessionKeys) }
    } catch {
      return { status: 'corrupt' }
    } finally {
      database?.close()
    }
  }

  /**
   * Creates or extends a project binding after an explicit user action.
   *
   * @param input cwd alias, selected external session keys, and optional existing project.
   * @returns The authoritative bound project or a safe mutation failure.
   */
  async bindProject(input: {
    cwd: string
    sessionKeys: readonly string[]
    projectKey?: string | undefined
  }): Promise<{ status: 'bound'; project: BoundProject } | MutationFailure> {
    const canonicalCwd = await canonicalizeCwd(input.cwd)
    if (canonicalCwd === undefined) return { status: 'unavailable' }
    const opened = await this.#openForMutation()
    if (opened.status !== 'ready') return { status: opened.status }
    const { database, key } = opened
    const identity = deriveProjectIdentity(canonicalCwd, key)

    try {
      database.exec('BEGIN IMMEDIATE')
      const alias = database.prepare('SELECT project_key FROM project_aliases WHERE alias_hash = ?').get(identity.aliasHash) as
        | { project_key: string }
        | undefined
      let projectKey = input.projectKey
      if (projectKey === undefined) projectKey = alias?.project_key ?? `prj_${randomBytes(16).toString('hex')}`
      const existingProject = database.prepare('SELECT 1 AS found FROM projects WHERE project_key = ?').get(projectKey)
      if (input.projectKey !== undefined && existingProject === undefined) {
        database.exec('ROLLBACK')
        return { status: 'unknown-project' }
      }
      if (alias !== undefined && alias.project_key !== projectKey) {
        database.exec('ROLLBACK')
        return { status: 'alias-conflict' }
      }
      if (existingProject === undefined) {
        database
          .prepare('INSERT INTO projects (project_key, basename, short_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(projectKey, identity.basename, identity.shortHash, now(), now())
      }
      database.prepare('INSERT OR IGNORE INTO project_aliases (alias_hash, project_key, created_at) VALUES (?, ?, ?)').run(
        identity.aliasHash,
        projectKey,
        now(),
      )
      database
        .prepare(
          'INSERT OR IGNORE INTO settings (project_key, capture_enabled, recall_enabled, recall_limit, recall_byte_budget, updated_at) VALUES (?, 0, 0, ?, ?, ?)',
        )
        .run(projectKey, this.#defaultRecallLimit, this.#defaultRecallByteBudget, now())
      const insertBinding = database.prepare(
        'INSERT OR REPLACE INTO bindings (project_key, session_hash, session_ciphertext, created_at) VALUES (?, ?, ?, ?)',
      )
      for (const sessionKey of new Set(input.sessionKeys.map((value) => value.trim()).filter((value) => value.length > 0))) {
        if (Array.from(sessionKey).length > 512) continue
        insertBinding.run(projectKey, hashSessionKey(key, sessionKey), encryptSessionKey(key, sessionKey), now())
      }
      database.exec('COMMIT')
    } catch {
      rollback(database)
      return { status: 'unavailable' }
    } finally {
      database.close()
    }

    const result = await this.lookupProject(canonicalCwd)
    return result.status === 'bound' ? result : { status: result.status === 'unbound' ? 'unavailable' : result.status }
  }

  /** Explicitly links another cwd alias to an existing project. */
  async linkProjectAlias(projectKey: string, cwd: string): Promise<{ status: 'linked' } | MutationFailure> {
    const result = await this.bindProject({ cwd, sessionKeys: [], projectKey })
    return result.status === 'bound' ? { status: 'linked' } : result
  }

  /** Applies explicit capture or recall setting changes to an existing project. */
  async updateSettings(
    projectKey: string,
    patch: {
      captureEnabled?: boolean | undefined
      recallEnabled?: boolean | undefined
      recallLimit?: number | undefined
      recallByteBudget?: number | undefined
    },
  ): Promise<{ status: 'updated' } | MutationFailure> {
    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: opened.status }
    const { database } = opened
    try {
      const current = database
        .prepare(
          'SELECT capture_enabled, recall_enabled, recall_limit, recall_byte_budget FROM settings WHERE project_key = ?',
        )
        .get(projectKey) as
        | { capture_enabled: number; recall_enabled: number; recall_limit: number; recall_byte_budget: number }
        | undefined
      if (current === undefined) return { status: 'unknown-project' }
      database
        .prepare(
          'UPDATE settings SET capture_enabled = ?, recall_enabled = ?, recall_limit = ?, recall_byte_budget = ?, updated_at = ? WHERE project_key = ?',
        )
        .run(
          patch.captureEnabled === undefined ? current.capture_enabled : Number(patch.captureEnabled),
          patch.recallEnabled === undefined ? current.recall_enabled : Number(patch.recallEnabled),
          patch.recallLimit ?? current.recall_limit,
          patch.recallByteBudget ?? current.recall_byte_budget,
          now(),
          projectKey,
        )
      return { status: 'updated' }
    } catch {
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  /** Returns whether capture is explicitly enabled for the bound cwd. */
  async canCapture(cwd: string): Promise<boolean> {
    const project = await this.lookupProject(cwd)
    return project.status === 'bound' && project.project.captureEnabled
  }

  /**
   * Handles a disposed session without writing when capture is disabled.
   *
   * @param cwd Current session cwd.
   * @param _messages Bounded in-memory messages reserved for the candidate service.
   * @returns Disabled or an enabled placeholder consumed by the candidate phase.
   */
  async recordDisposedSession(
    cwd: string,
    _messages: readonly string[],
  ): Promise<{ status: 'disabled' | 'no-candidate' }> {
    return (await this.canCapture(cwd)) ? { status: 'no-candidate' } : { status: 'disabled' }
  }

  /** Persists review-only candidates after capture has already been explicitly enabled. */
  async createPendingCandidates(
    projectKey: string,
    sourceSessionId: string,
    drafts: readonly CandidateDraft[],
  ): Promise<
    | { status: 'created'; candidateIds: string[] }
    | { status: 'no-candidate' | 'rejected-sensitive' }
    | MutationFailure
  > {
    const normalized = drafts
      .map((draft) => ({ ...draft, content: truncateUtf8(draft.content.trim(), 2_000).text }))
      .filter((draft) => draft.content.length > 0)
    if (normalized.length === 0) return { status: 'no-candidate' }
    if (normalized.some((draft) => !inspectPrivacy(draft.content).safe)) return { status: 'rejected-sensitive' }

    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: opened.status }
    const { database, key } = opened
    try {
      if (database.prepare('SELECT 1 FROM projects WHERE project_key = ?').get(projectKey) === undefined) {
        return { status: 'unknown-project' }
      }
      const sourceHash = hashSessionKey(key, sourceSessionId)
      const candidateIds = normalized.map((draft) =>
        opaqueId(key, 'memcand', `${projectKey}\u0000${sourceHash}\u0000${draft.scope}\u0000${draft.kind}\u0000${draft.content}`),
      )
      const timestamp = now()
      database.exec('BEGIN IMMEDIATE')
      const insert = database.prepare(`
        INSERT OR IGNORE INTO candidates
          (candidate_id, project_key, scope, kind, content, source_session_hash, status, pinned, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
      `)
      normalized.forEach((draft, index) => {
        const candidateId = candidateIds[index]!
        insert.run(candidateId, projectKey, draft.scope, draft.kind, draft.content, sourceHash, timestamp, timestamp)
        writeAudit(database, key, projectKey, 'candidate-created', candidateId)
      })
      database.exec('COMMIT')
      return { status: 'created', candidateIds }
    } catch {
      rollback(database)
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  /** Lists pathless candidate summaries for one explicitly bound project. */
  async listCandidates(projectKey: string): Promise<CandidateRecord[]> {
    const opened = await this.#openReadOnly()
    if (opened.status !== 'ready') return []
    const { database } = opened
    try {
      const rows = database
        .prepare(`
          SELECT c.candidate_id, c.project_key, p.short_hash AS project_short_hash, c.scope, c.kind,
                 c.content, c.status, c.pinned, c.created_at, c.updated_at
          FROM candidates AS c INNER JOIN projects AS p ON p.project_key = c.project_key
          WHERE c.project_key = ? ORDER BY c.created_at DESC, c.candidate_id
        `)
        .all(projectKey) as unknown as CandidateRow[]
      return rows.map(candidateFromRow)
    } catch {
      return []
    } finally {
      database.close()
    }
  }

  /** Edits a pending candidate after an explicit review action. */
  async editCandidate(
    candidateId: string,
    patch: Partial<CandidateDraft>,
  ): Promise<{ status: 'updated' | 'unknown-candidate' | 'not-pending' | 'rejected-sensitive' | 'unavailable' }> {
    if (patch.content !== undefined && !inspectPrivacy(patch.content).safe) return { status: 'rejected-sensitive' }
    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: 'unavailable' }
    const { database, key } = opened
    try {
      const row = database
        .prepare('SELECT project_key, scope, kind, content, status FROM candidates WHERE candidate_id = ?')
        .get(candidateId) as
        | { project_key: string; scope: CandidateScope; kind: CandidateKind; content: string; status: string }
        | undefined
      if (row === undefined) return { status: 'unknown-candidate' }
      if (row.status !== 'pending') return { status: 'not-pending' }
      const content = patch.content === undefined ? row.content : truncateUtf8(patch.content.trim(), 2_000).text
      if (content.length === 0) return { status: 'rejected-sensitive' }
      database
        .prepare('UPDATE candidates SET scope = ?, kind = ?, content = ?, updated_at = ? WHERE candidate_id = ?')
        .run(patch.scope ?? row.scope, patch.kind ?? row.kind, content, now(), candidateId)
      writeAudit(database, key, row.project_key, 'candidate-edited', candidateId)
      return { status: 'updated' }
    } catch {
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  /** Promotes one reviewed candidate into the approved memory collection. */
  async approveCandidate(
    candidateId: string,
    patch: Partial<CandidateDraft>,
  ): Promise<
    | { status: 'approved'; memoryId: string }
    | { status: 'unknown-candidate' | 'not-pending' | 'rejected-sensitive' | 'unavailable' }
  > {
    if (patch.content !== undefined && !inspectPrivacy(patch.content).safe) return { status: 'rejected-sensitive' }
    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: 'unavailable' }
    const { database, key } = opened
    try {
      const row = database
        .prepare('SELECT project_key, scope, kind, content, status, pinned FROM candidates WHERE candidate_id = ?')
        .get(candidateId) as
        | { project_key: string; scope: CandidateScope; kind: CandidateKind; content: string; status: string; pinned: number }
        | undefined
      if (row === undefined) return { status: 'unknown-candidate' }
      if (row.status !== 'pending') return { status: 'not-pending' }
      const content = patch.content === undefined ? row.content : truncateUtf8(patch.content.trim(), 2_000).text
      if (content.length === 0 || !inspectPrivacy(content).safe) return { status: 'rejected-sensitive' }
      const scope = patch.scope ?? row.scope
      const kind = patch.kind ?? row.kind
      const memoryId = opaqueId(key, 'approved', candidateId)
      const timestamp = now()
      database.exec('BEGIN IMMEDIATE')
      database
        .prepare(`
          INSERT INTO approved_memories
            (memory_id, project_key, scope, kind, content, sources_json, pinned, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          memoryId,
          scope === 'personal' ? null : row.project_key,
          scope,
          kind,
          content,
          JSON.stringify([candidateId]),
          row.pinned,
          timestamp,
          timestamp,
        )
      database
        .prepare("UPDATE candidates SET scope = ?, kind = ?, content = ?, status = 'approved', updated_at = ? WHERE candidate_id = ?")
        .run(scope, kind, content, timestamp, candidateId)
      writeAudit(database, key, row.project_key, 'candidate-approved', candidateId)
      database.exec('COMMIT')
      return { status: 'approved', memoryId }
    } catch {
      rollback(database)
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  /** Changes pin state for a candidate and any approved memory derived from it. */
  async setCandidatePinned(
    candidateId: string,
    pinned: boolean,
  ): Promise<{ status: 'updated' | 'unknown-candidate' | 'unavailable' }> {
    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: 'unavailable' }
    const { database, key } = opened
    try {
      const row = database.prepare('SELECT project_key FROM candidates WHERE candidate_id = ?').get(candidateId) as
        | { project_key: string }
        | undefined
      if (row === undefined) return { status: 'unknown-candidate' }
      database.exec('BEGIN IMMEDIATE')
      database.prepare('UPDATE candidates SET pinned = ?, updated_at = ? WHERE candidate_id = ?').run(Number(pinned), now(), candidateId)
      database
        .prepare(`
          UPDATE approved_memories SET pinned = ?, updated_at = ?
          WHERE EXISTS (SELECT 1 FROM json_each(approved_memories.sources_json) WHERE value = ?)
        `)
        .run(Number(pinned), now(), candidateId)
      writeAudit(database, key, row.project_key, pinned ? 'candidate-pinned' : 'candidate-unpinned', candidateId)
      database.exec('COMMIT')
      return { status: 'updated' }
    } catch {
      rollback(database)
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  /** Forgets a candidate and removes approved material derived from it. */
  async forgetCandidate(
    candidateId: string,
  ): Promise<{ status: 'forgotten' | 'unknown-candidate' | 'unavailable' }> {
    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: 'unavailable' }
    const { database, key } = opened
    try {
      const row = database.prepare('SELECT project_key FROM candidates WHERE candidate_id = ?').get(candidateId) as
        | { project_key: string }
        | undefined
      if (row === undefined) return { status: 'unknown-candidate' }
      database.exec('BEGIN IMMEDIATE')
      database
        .prepare("UPDATE candidates SET status = 'forgotten', updated_at = ? WHERE candidate_id = ?")
        .run(now(), candidateId)
      database
        .prepare(`DELETE FROM approved_memories
          WHERE EXISTS (SELECT 1 FROM json_each(approved_memories.sources_json) WHERE value = ?)`)
        .run(candidateId)
      writeAudit(database, key, row.project_key, 'candidate-forgotten', candidateId)
      database.exec('COMMIT')
      return { status: 'forgotten' }
    } catch {
      rollback(database)
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  /** Merges pending candidates only when all sources belong to the same project. */
  async mergeCandidates(
    candidateIds: readonly string[],
    draft: CandidateDraft,
  ): Promise<
    | { status: 'merged'; candidateId: string }
    | { status: 'invalid-candidates' | 'cross-project' | 'rejected-sensitive' | 'unavailable' }
  > {
    const uniqueIds = [...new Set(candidateIds)]
    if (uniqueIds.length < 2) return { status: 'invalid-candidates' }
    const content = truncateUtf8(draft.content.trim(), 2_000).text
    if (content.length === 0 || !inspectPrivacy(content).safe) return { status: 'rejected-sensitive' }
    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: 'unavailable' }
    const { database, key } = opened
    try {
      const placeholders = uniqueIds.map(() => '?').join(', ')
      const rows = database
        .prepare(`SELECT candidate_id, project_key, status FROM candidates WHERE candidate_id IN (${placeholders})`)
        .all(...uniqueIds) as unknown as { candidate_id: string; project_key: string; status: string }[]
      if (rows.length !== uniqueIds.length || rows.some((row) => row.status !== 'pending')) {
        return { status: 'invalid-candidates' }
      }
      const projectKeys = new Set(rows.map((row) => row.project_key))
      if (projectKeys.size !== 1) return { status: 'cross-project' }
      const projectKey = rows[0]!.project_key
      const sortedSources = [...uniqueIds].sort()
      const candidateId = opaqueId(
        key,
        'memcand',
        `${projectKey}\u0000merge\u0000${sortedSources.join('\u0000')}\u0000${draft.scope}\u0000${draft.kind}\u0000${content}`,
      )
      const timestamp = now()
      database.exec('BEGIN IMMEDIATE')
      database
        .prepare(`UPDATE candidates SET status = 'forgotten', updated_at = ? WHERE candidate_id IN (${placeholders})`)
        .run(timestamp, ...uniqueIds)
      database
        .prepare(`
          INSERT INTO candidates
            (candidate_id, project_key, scope, kind, content, source_session_hash, status, pinned, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
        `)
        .run(candidateId, projectKey, draft.scope, draft.kind, content, opaqueId(key, 'source', sortedSources.join('\u0000')), timestamp, timestamp)
      writeAudit(database, key, projectKey, 'candidates-merged', candidateId)
      database.exec('COMMIT')
      return { status: 'merged', candidateId }
    } catch {
      rollback(database)
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  /** Reads approved content under an exact project or personal scope boundary. */
  async listApprovedMemories(input: { projectKey: string; scope: CandidateScope }): Promise<ApprovedMemory[]> {
    const opened = await this.#openReadOnly()
    if (opened.status !== 'ready') return []
    const { database } = opened
    try {
      const rows = (input.scope === 'personal'
        ? database
            .prepare(`
              SELECT m.memory_id, NULL AS project_short_hash, m.scope, m.kind, m.content,
                     m.sources_json, m.pinned, m.created_at, m.updated_at
              FROM approved_memories AS m WHERE m.scope = 'personal' AND m.project_key IS NULL
              ORDER BY m.pinned DESC, m.updated_at DESC, m.memory_id
            `)
            .all()
        : database
            .prepare(`
              SELECT m.memory_id, p.short_hash AS project_short_hash, m.scope, m.kind, m.content,
                     m.sources_json, m.pinned, m.created_at, m.updated_at
              FROM approved_memories AS m INNER JOIN projects AS p ON p.project_key = m.project_key
              WHERE m.scope = 'project' AND m.project_key = ?
              ORDER BY m.pinned DESC, m.updated_at DESC, m.memory_id
            `)
            .all(input.projectKey)) as unknown as ApprovedMemoryRow[]
      return rows.map(approvedFromRow)
    } catch {
      return []
    } finally {
      database.close()
    }
  }

  /** Exports only user-reviewed plugin state for one project, never cwd or external session keys. */
  async exportProject(projectKey: string): Promise<
    | { status: 'exported'; project: ProjectSummary; candidates: CandidateRecord[]; approvedMemories: ApprovedMemory[] }
    | { status: 'unknown-project' }
  > {
    const projects = await this.listProjects()
    const project = projects.find((item) => item.projectKey === projectKey)
    if (project === undefined) return { status: 'unknown-project' }
    const [candidates, approvedMemories] = await Promise.all([
      this.listCandidates(projectKey),
      this.listApprovedMemories({ projectKey, scope: 'project' }),
    ])
    return { status: 'exported', project, candidates, approvedMemories }
  }

  /** Lists project display fields without cwd or external session identifiers. */
  async listProjects(): Promise<ProjectSummary[]> {
    const state = await this.#inspectStateDatabase()
    if (state.status !== 'present') return []
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.#databasePath, { readOnly: true, allowExtension: false, timeout: 250 })
      if (validateSchema(database) !== 'ready') return []
      const rows = database
        .prepare(`
          SELECT p.project_key, p.basename, p.short_hash, s.capture_enabled, s.recall_enabled,
                 s.recall_limit, s.recall_byte_budget
          FROM projects AS p INNER JOIN settings AS s ON s.project_key = p.project_key
          ORDER BY p.created_at, p.project_key
        `)
        .all() as unknown as ProjectRow[]
      return rows.map((row) => {
        const { sessionKeys: _sessionKeys, ...summary } = projectFromRow(row, [])
        return summary
      })
    } catch {
      return []
    } finally {
      database?.close()
    }
  }

  /** Deletes only plugin-owned rows for one project. */
  async deleteProject(projectKey: string): Promise<{ status: 'deleted' } | MutationFailure> {
    const opened = await this.#openExistingForMutation()
    if (opened.status !== 'ready') return { status: opened.status }
    const { database } = opened
    try {
      database.exec('BEGIN IMMEDIATE')
      database.prepare(`
        DELETE FROM approved_memories
        WHERE EXISTS (
          SELECT 1 FROM json_each(approved_memories.sources_json) AS source
          INNER JOIN candidates AS candidate ON candidate.candidate_id = source.value
          WHERE candidate.project_key = ?
        )
      `).run(projectKey)
      const result = database.prepare('DELETE FROM projects WHERE project_key = ?').run(projectKey)
      database.exec('COMMIT')
      return result.changes > 0 ? { status: 'deleted' } : { status: 'unknown-project' }
    } catch {
      rollback(database)
      return { status: 'unavailable' }
    } finally {
      database.close()
    }
  }

  async #inspectStateDatabase(): Promise<
    { status: 'present' | 'missing' | 'unsafe-state' | 'unavailable' }
  > {
    if (!isAbsolute(this.#stateDirectory)) return { status: 'unsafe-state' }
    try {
      const directory = await lstat(this.#stateDirectory)
      if (!directory.isDirectory() || directory.isSymbolicLink()) return { status: 'unsafe-state' }
      const database = await lstat(this.#databasePath)
      if (!database.isFile() || database.isSymbolicLink()) return { status: 'unsafe-state' }
      return { status: 'present' }
    } catch (error) {
      if (isMissing(error)) return { status: 'missing' }
      return { status: 'unavailable' }
    }
  }

  async #openForMutation(): Promise<
    | { status: 'ready'; database: DatabaseSync; key: Buffer }
    | { status: 'corrupt' | 'incompatible-state' | 'unsafe-state' | 'unavailable' }
  > {
    const state = await this.#inspectStateDatabase()
    if (state.status === 'unsafe-state') return { status: 'unsafe-state' }
    if (state.status === 'unavailable') return { status: 'unavailable' }
    const key = await loadOrCreateLocalKey(this.#stateDirectory)
    if (key.status !== 'ready') return { status: key.status === 'missing' ? 'unavailable' : key.status }
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.#databasePath, { allowExtension: false, timeout: 250 })
      database.exec('PRAGMA foreign_keys = ON')
      await chmod(this.#databasePath, 0o600)
      const schema = initializeOrValidateSchema(database, key.key)
      if (schema !== 'ready') {
        database.close()
        return { status: schema }
      }
      return { status: 'ready', database, key: key.key }
    } catch {
      database?.close()
      return { status: 'unavailable' }
    }
  }

  async #openExistingForMutation(): Promise<
    | { status: 'ready'; database: DatabaseSync; key: Buffer }
    | { status: 'corrupt' | 'incompatible-state' | 'unsafe-state' | 'unavailable' | 'unknown-project' }
  > {
    const state = await this.#inspectStateDatabase()
    if (state.status === 'missing') return { status: 'unknown-project' }
    if (state.status === 'unsafe-state') return { status: 'unsafe-state' }
    if (state.status === 'unavailable') return { status: 'unavailable' }
    const key = await loadLocalKey(this.#stateDirectory)
    if (key.status !== 'ready') return { status: key.status === 'unsafe-state' ? 'unsafe-state' : 'corrupt' }
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.#databasePath, { allowExtension: false, timeout: 250 })
      database.exec('PRAGMA foreign_keys = ON')
      const schema = validateSchema(database)
      if (schema !== 'ready') {
        database.close()
        return { status: schema }
      }
      if (!validateKey(database, key.key)) {
        database.close()
        return { status: 'corrupt' }
      }
      return { status: 'ready', database, key: key.key }
    } catch {
      database?.close()
      return { status: 'unavailable' }
    }
  }

  async #openReadOnly(): Promise<
    | { status: 'ready'; database: DatabaseSync }
    | { status: 'missing' | 'corrupt' | 'incompatible-state' | 'unsafe-state' | 'unavailable' }
  > {
    const state = await this.#inspectStateDatabase()
    if (state.status !== 'present') return { status: state.status }
    const key = await loadLocalKey(this.#stateDirectory)
    if (key.status !== 'ready') return { status: key.status === 'unsafe-state' ? 'unsafe-state' : 'corrupt' }
    let database: DatabaseSync | undefined
    try {
      database = new DatabaseSync(this.#databasePath, { readOnly: true, allowExtension: false, timeout: 250 })
      const schema = validateSchema(database)
      if (schema !== 'ready') {
        database.close()
        return { status: schema }
      }
      if (!validateKey(database, key.key)) {
        database.close()
        return { status: 'corrupt' }
      }
      return { status: 'ready', database }
    } catch {
      database?.close()
      return { status: 'unavailable' }
    }
  }
}

function initializeOrValidateSchema(database: DatabaseSync, key: Uint8Array): 'ready' | 'corrupt' | 'incompatible-state' {
  const version = schemaVersion(database)
  if (version > STATE_SCHEMA_VERSION) return 'incompatible-state'
  if (version === STATE_SCHEMA_VERSION) return validateKey(database, key) ? 'ready' : 'corrupt'
  const tableCount = database.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type = 'table'").get() as {
    count: number
  }
  if (tableCount.count > 0) return 'incompatible-state'
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE projects (
      project_key TEXT PRIMARY KEY,
      basename TEXT NOT NULL,
      short_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE project_aliases (
      alias_hash TEXT PRIMARY KEY,
      project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE bindings (
      project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
      session_hash TEXT NOT NULL,
      session_ciphertext TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_key, session_hash)
    );
    CREATE TABLE settings (
      project_key TEXT PRIMARY KEY REFERENCES projects(project_key) ON DELETE CASCADE,
      capture_enabled INTEGER NOT NULL CHECK (capture_enabled IN (0, 1)),
      recall_enabled INTEGER NOT NULL CHECK (recall_enabled IN (0, 1)),
      recall_limit INTEGER NOT NULL CHECK (recall_limit BETWEEN 1 AND 5),
      recall_byte_budget INTEGER NOT NULL CHECK (recall_byte_budget BETWEEN 1 AND 6000),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE candidates (
      candidate_id TEXT PRIMARY KEY,
      project_key TEXT NOT NULL REFERENCES projects(project_key) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      source_session_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE approved_memories (
      memory_id TEXT PRIMARY KEY,
      project_key TEXT REFERENCES projects(project_key) ON DELETE CASCADE,
      scope TEXT NOT NULL,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE audit_log (
      event_id TEXT PRIMARY KEY,
      project_key TEXT REFERENCES projects(project_key) ON DELETE CASCADE,
      action TEXT NOT NULL,
      target_hash TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `)
  database.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('key_check', keyFingerprint(key))
  return 'ready'
}

function validateSchema(database: DatabaseSync): 'ready' | 'incompatible-state' {
  return schemaVersion(database) === STATE_SCHEMA_VERSION ? 'ready' : 'incompatible-state'
}

function schemaVersion(database: DatabaseSync): number {
  return (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
}

function validateKey(database: DatabaseSync, key: Uint8Array): boolean {
  const row = database.prepare("SELECT value FROM metadata WHERE key = 'key_check'").get() as { value: string } | undefined
  return row?.value === keyFingerprint(key)
}

function projectFromRow(row: ProjectRow, sessionKeys: string[]): BoundProject {
  return {
    projectKey: row.project_key,
    basename: row.basename,
    shortHash: row.short_hash,
    captureEnabled: row.capture_enabled === 1,
    recallEnabled: row.recall_enabled === 1,
    recallLimit: row.recall_limit,
    recallByteBudget: row.recall_byte_budget,
    sessionKeys,
  }
}

async function canonicalizeCwd(cwd: string): Promise<string | undefined> {
  if (!isAbsolute(cwd)) return undefined
  try {
    return await realpath(cwd)
  } catch {
    return undefined
  }
}

function rollback(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK')
  } catch {
    // The transaction may have failed before BEGIN; there is nothing to roll back.
  }
}

function now(): string {
  return new Date().toISOString()
}

function opaqueId(key: Uint8Array, prefix: string, value: string): string {
  return `${prefix}_${createHmac('sha256', key).update(value).digest('hex').slice(0, 24)}`
}

function writeAudit(database: DatabaseSync, key: Uint8Array, projectKey: string, action: string, targetId: string): void {
  database
    .prepare('INSERT INTO audit_log (event_id, project_key, action, target_hash, occurred_at) VALUES (?, ?, ?, ?, ?)')
    .run(
      opaqueId(key, 'audit', `${randomBytes(16).toString('hex')}\u0000${action}`),
      projectKey,
      action,
      opaqueId(key, 'target', targetId),
      now(),
    )
}

function candidateFromRow(row: CandidateRow): CandidateRecord {
  return {
    candidateId: row.candidate_id,
    projectShortHash: row.project_short_hash,
    scope: row.scope,
    kind: row.kind,
    content: row.content,
    status: row.status,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function approvedFromRow(row: ApprovedMemoryRow): ApprovedMemory {
  let sourceCandidateIds: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.sources_json)
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) sourceCandidateIds = parsed
  } catch {
    // A malformed plugin-owned row is omitted from source metadata, not exposed as an error.
  }
  return {
    memoryId: row.memory_id,
    ...(row.project_short_hash === null ? {} : { projectShortHash: row.project_short_hash }),
    scope: row.scope,
    kind: row.kind,
    content: row.content,
    sourceCandidateIds,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
