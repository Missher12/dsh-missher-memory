import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  BindProjectRequestSchema,
  CandidateReviewRequestSchema,
  DeleteProjectRequestSchema,
  ExportProjectRequestSchema,
  ExportProjectResultSchema,
  MemorySnapshotSchema,
  UpdateSettingsRequestSchema,
  type BindProjectRequest,
  type CandidateReviewRequest,
  type DeleteProjectRequest,
  type ExportProjectRequest,
  type ExportProjectResult,
  type MemorySnapshot,
  type UpdateSettingsRequest,
} from './remote-contract.ts'

/** Host operations exposed to the strict Client RPC adapter. */
export interface MissherMemoryRemoteBackend {
  snapshot(): Promise<MemorySnapshot>
  bindProject(request: BindProjectRequest): Promise<MemorySnapshot>
  updateSettings(request: UpdateSettingsRequest): Promise<MemorySnapshot>
  deleteProject(request: DeleteProjectRequest): Promise<MemorySnapshot>
  reviewCandidate(request: CandidateReviewRequest): Promise<MemorySnapshot>
  exportProject(request: ExportProjectRequest): Promise<ExportProjectResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    missherMemory: MissherMemoryRemote
  }
}

/** Strict pathless RPC service for the memory settings Client. */
export class MissherMemoryRemote extends TypertRemoteService {
  /** Creates and registers the RPC service. */
  constructor(
    ctx: Context,
    private readonly backend: MissherMemoryRemoteBackend,
  ) {
    super(ctx, 'missherMemory')
  }

  /** Returns the current pathless connection, project, setting, and candidate view. */
  @Remote('snapshot')
  async snapshot(): Promise<MemorySnapshot> {
    return callSnapshot(() => this.backend.snapshot())
  }

  /** Confirms a candidate and selected opaque source handles as a project binding. */
  @Remote('bindProject')
  async bindProject(input: BindProjectRequest): Promise<MemorySnapshot> {
    const request = parseRequest(BindProjectRequestSchema, input)
    return callSnapshot(() => this.backend.bindProject(request))
  }

  /** Applies an explicit project settings mutation. */
  @Remote('updateSettings')
  async updateSettings(input: UpdateSettingsRequest): Promise<MemorySnapshot> {
    const request = parseRequest(UpdateSettingsRequestSchema, input)
    return callSnapshot(() => this.backend.updateSettings(request))
  }

  /** Deletes only plugin-owned state after exact confirmation. */
  @Remote('deleteProject')
  async deleteProject(input: DeleteProjectRequest): Promise<MemorySnapshot> {
    const request = parseRequest(DeleteProjectRequestSchema, input)
    return callSnapshot(() => this.backend.deleteProject(request))
  }

  /** Applies one explicit candidate inbox review action. */
  @Remote('reviewCandidate')
  async reviewCandidate(input: CandidateReviewRequest): Promise<MemorySnapshot> {
    const request = parseRequest(CandidateReviewRequestSchema, input)
    return callSnapshot(() => this.backend.reviewCandidate(request))
  }

  /** Returns a pathless JSON export for a browser-owned download. */
  @Remote('exportProject')
  async exportProject(input: ExportProjectRequest): Promise<ExportProjectResult> {
    const request = parseRequest(ExportProjectRequestSchema, input)
    try {
      return ExportProjectResultSchema.parse(await this.backend.exportProject(request))
    } catch {
      throw publicError('memory_operation_failed')
    }
  }
}

async function callSnapshot(operation: () => Promise<MemorySnapshot>): Promise<MemorySnapshot> {
  try {
    return MemorySnapshotSchema.parse(await operation())
  } catch {
    throw publicError('memory_operation_failed')
  }
}

function parseRequest<T>(schema: { parse(input: unknown): T }, input: unknown): T {
  try {
    return schema.parse(input)
  } catch {
    throw publicError('invalid_request')
  }
}

function publicError(code: 'invalid_request' | 'memory_operation_failed'): Error & { code: string } {
  return Object.assign(new Error(code), { code })
}
