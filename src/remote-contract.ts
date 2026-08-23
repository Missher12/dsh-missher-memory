import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'

const shortHash = z.string().regex(/^[a-f0-9]{8}$/u)
const projectKey = z.string().regex(/^prj_[a-f0-9]{32}$/u)
const projectCandidateId = z.string().regex(/^cand_[a-f0-9]{16}$/u)
const memoryCandidateId = z.string().regex(/^memcand_[a-f0-9]{24}$/u)
const sourceId = z.string().regex(/^src_[a-f0-9]{16}$/u)
const nonnegativeCounter = z.number().int().nonnegative().max(1_000_000_000)
const candidateScope = z.enum(['project', 'personal'])
const candidateKind = z.enum(['architecture', 'decision', 'progress', 'failure', 'next', 'project-preference', 'personal-preference'])
const candidateContent = z.string().trim().min(1).max(2_000)

export const MemoryDatabaseStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not-configured'), source: z.enum(['default', 'environment']) }).strict(),
  z.object({ status: z.literal('unsafe-path'), source: z.enum(['default', 'environment']) }).strict(),
  z.object({ status: z.literal('unavailable'), source: z.enum(['default', 'environment']) }).strict(),
  z.object({ status: z.literal('corrupt'), source: z.enum(['default', 'environment']) }).strict(),
  z.object({
    status: z.literal('incompatible'),
    source: z.enum(['default', 'environment']),
    schema: z.object({ l0: z.boolean(), l1: z.boolean(), fts5: z.boolean() }).strict(),
  }).strict(),
  z.object({
    status: z.literal('ready'),
    source: z.enum(['default', 'environment']),
    schema: z.object({ l0: z.literal(true), l1: z.literal(true), fts5: z.literal(true) }).strict(),
  }).strict(),
])

export const ProjectCandidateSchema = z.object({
  candidateId: projectCandidateId,
  basename: z.string().min(1).max(255),
  shortHash,
}).strict()

export const ProjectViewSchema = z.object({
  projectKey,
  basename: z.string().min(1).max(255),
  shortHash,
  captureEnabled: z.boolean(),
  recallEnabled: z.boolean(),
  recallLimit: z.number().int().min(1).max(5),
  recallByteBudget: z.number().int().min(1).max(6_000),
}).strict()

export const SourceViewSchema = z.object({
  sourceId,
  shortHash,
  recordCount: nonnegativeCounter,
  firstAt: z.string().nullable(),
  lastAt: z.string().nullable(),
  bound: z.boolean(),
}).strict()

export const CandidateViewSchema = z.object({
  candidateId: memoryCandidateId,
  projectShortHash: shortHash,
  scope: candidateScope,
  kind: candidateKind,
  content: z.string().min(1).max(2_000),
  status: z.enum(['pending', 'approved', 'forgotten']),
  pinned: z.boolean(),
  createdAt: z.string(),
}).strict()

export const MemorySnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  database: MemoryDatabaseStatusSchema,
  projectCandidate: ProjectCandidateSchema.nullable(),
  project: ProjectViewSchema.nullable(),
  projects: z.array(ProjectViewSchema).max(200),
  sources: z.array(SourceViewSchema).max(200),
  candidates: z.array(CandidateViewSchema).max(500),
  approvedCount: nonnegativeCounter,
}).strict()

export const BindProjectRequestSchema = z.object({
  candidateId: projectCandidateId,
  sourceIds: z.array(sourceId).max(200),
  existingProjectKey: projectKey.optional(),
}).strict()

export const UpdateSettingsRequestSchema = z
  .object({
    projectKey,
    captureEnabled: z.boolean().optional(),
    recallEnabled: z.boolean().optional(),
    recallLimit: z.number().int().min(1).max(5).optional(),
    recallByteBudget: z.number().int().min(1).max(6_000).optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.captureEnabled !== undefined ||
      request.recallEnabled !== undefined ||
      request.recallLimit !== undefined ||
      request.recallByteBudget !== undefined,
    { message: 'at least one setting is required' },
  )

export const DeleteProjectRequestSchema = z.object({
  projectKey,
  confirmation: z.literal('DELETE_PROJECT'),
}).strict()

export const CandidateReviewRequestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('edit'),
    candidateId: memoryCandidateId,
    content: candidateContent,
    scope: candidateScope.optional(),
    kind: candidateKind.optional(),
  }).strict(),
  z.object({
    action: z.literal('approve'),
    candidateId: memoryCandidateId,
    content: candidateContent.optional(),
    scope: candidateScope.optional(),
    kind: candidateKind.optional(),
  }).strict(),
  z.object({ action: z.literal('pin'), candidateId: memoryCandidateId, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal('forget'), candidateId: memoryCandidateId }).strict(),
  z.object({
    action: z.literal('merge'),
    candidateIds: z.array(memoryCandidateId).min(2).max(20),
    content: candidateContent,
    scope: candidateScope,
    kind: candidateKind,
  }).strict(),
])

export const ExportProjectRequestSchema = z.object({ projectKey }).strict()
export const ExportProjectResultSchema = z.object({
  fileName: z.string().regex(/^missher-memory-[a-zA-Z0-9._-]{1,120}\.json$/u),
  content: z.string().max(2_000_000),
}).strict()

export type MemorySnapshot = z.infer<typeof MemorySnapshotSchema>
export type BindProjectRequest = z.infer<typeof BindProjectRequestSchema>
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>
export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequestSchema>
export type CandidateReviewRequest = z.infer<typeof CandidateReviewRequestSchema>
export type ExportProjectRequest = z.infer<typeof ExportProjectRequestSchema>
export type ExportProjectResult = z.infer<typeof ExportProjectResultSchema>

function strictCodec(typeSymbol: string, schema: z.ZodType): InvocationDescriptor['result'] {
  return { mode: 'strict', typeSymbol, schema }
}

const PACKAGE = 'dsh-missher-memory'
const SERVICE = 'missherMemory'

export const invocationDescriptors = Object.freeze([
  {
    id: `${PACKAGE}#${SERVICE}/snapshot`,
    service: SERVICE,
    namespace: SERVICE,
    method: 'snapshot',
    invocation: { kind: 'direct' },
    parameters: [],
    result: strictCodec(`${PACKAGE}#MemorySnapshot`, MemorySnapshotSchema),
    sourceLocation: { file: 'src/remote.ts', line: 34, column: 3 },
  },
  {
    id: `${PACKAGE}#${SERVICE}/bindProject`,
    service: SERVICE,
    namespace: SERVICE,
    method: 'bindProject',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: strictCodec(`${PACKAGE}#BindProjectRequest`, BindProjectRequestSchema),
    }],
    result: strictCodec(`${PACKAGE}#MemorySnapshot`, MemorySnapshotSchema),
    sourceLocation: { file: 'src/remote.ts', line: 39, column: 3 },
  },
  {
    id: `${PACKAGE}#${SERVICE}/updateSettings`,
    service: SERVICE,
    namespace: SERVICE,
    method: 'updateSettings',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: strictCodec(`${PACKAGE}#UpdateSettingsRequest`, UpdateSettingsRequestSchema),
    }],
    result: strictCodec(`${PACKAGE}#MemorySnapshot`, MemorySnapshotSchema),
    sourceLocation: { file: 'src/remote.ts', line: 44, column: 3 },
  },
  {
    id: `${PACKAGE}#${SERVICE}/deleteProject`,
    service: SERVICE,
    namespace: SERVICE,
    method: 'deleteProject',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: strictCodec(`${PACKAGE}#DeleteProjectRequest`, DeleteProjectRequestSchema),
    }],
    result: strictCodec(`${PACKAGE}#MemorySnapshot`, MemorySnapshotSchema),
    sourceLocation: { file: 'src/remote.ts', line: 49, column: 3 },
  },
  {
    id: `${PACKAGE}#${SERVICE}/reviewCandidate`,
    service: SERVICE,
    namespace: SERVICE,
    method: 'reviewCandidate',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: strictCodec(`${PACKAGE}#CandidateReviewRequest`, CandidateReviewRequestSchema),
    }],
    result: strictCodec(`${PACKAGE}#MemorySnapshot`, MemorySnapshotSchema),
    sourceLocation: { file: 'src/remote.ts', line: 54, column: 3 },
  },
  {
    id: `${PACKAGE}#${SERVICE}/exportProject`,
    service: SERVICE,
    namespace: SERVICE,
    method: 'exportProject',
    invocation: { kind: 'direct' },
    parameters: [{
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: strictCodec(`${PACKAGE}#ExportProjectRequest`, ExportProjectRequestSchema),
    }],
    result: strictCodec(`${PACKAGE}#ExportProjectResult`, ExportProjectResultSchema),
    sourceLocation: { file: 'src/remote.ts', line: 59, column: 3 },
  },
] as const satisfies readonly InvocationDescriptor[])
