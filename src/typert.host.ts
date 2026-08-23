import {
  BindProjectRequestSchema,
  CandidateReviewRequestSchema,
  DeleteProjectRequestSchema,
  ExportProjectRequestSchema,
  ExportProjectResultSchema,
  MemorySnapshotSchema,
  UpdateSettingsRequestSchema,
  invocationDescriptors,
} from './remote-contract.ts'

/** Typert Host contribution for the memory settings RPC. */
export const TYPERT = {
  package: 'dsh-missher-memory',
  face: 'host',
  schemas: [
    { name: 'MemorySnapshot', schema: MemorySnapshotSchema },
    { name: 'BindProjectRequest', schema: BindProjectRequestSchema },
    { name: 'UpdateSettingsRequest', schema: UpdateSettingsRequestSchema },
    { name: 'DeleteProjectRequest', schema: DeleteProjectRequestSchema },
    { name: 'CandidateReviewRequest', schema: CandidateReviewRequestSchema },
    { name: 'ExportProjectRequest', schema: ExportProjectRequestSchema },
    { name: 'ExportProjectResult', schema: ExportProjectResultSchema },
  ],
  invocations: invocationDescriptors,
  model: {
    services: [{
      tags: [],
      description: 'Project-scoped reviewed memory settings service.',
      key: 'missherMemory',
      exportName: 'MissherMemoryRemote',
      members: [
        { kind: 'method', name: 'snapshot', signature: 'snapshot(): Promise<MemorySnapshot>' },
        { kind: 'method', name: 'bindProject', signature: 'bindProject(request: BindProjectRequest): Promise<MemorySnapshot>' },
        { kind: 'method', name: 'updateSettings', signature: 'updateSettings(request: UpdateSettingsRequest): Promise<MemorySnapshot>' },
        { kind: 'method', name: 'deleteProject', signature: 'deleteProject(request: DeleteProjectRequest): Promise<MemorySnapshot>' },
        { kind: 'method', name: 'reviewCandidate', signature: 'reviewCandidate(request: CandidateReviewRequest): Promise<MemorySnapshot>' },
        { kind: 'method', name: 'exportProject', signature: 'exportProject(request: ExportProjectRequest): Promise<ExportProjectResult>' },
      ],
      types: [],
    }],
    events: [],
    objects: [],
  },
} as const

export default TYPERT
