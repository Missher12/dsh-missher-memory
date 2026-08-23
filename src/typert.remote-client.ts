import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { invocationDescriptors } from './remote-contract.ts'
import type {
  BindProjectRequest,
  CandidateReviewRequest,
  DeleteProjectRequest,
  ExportProjectRequest,
  ExportProjectResult,
  MemorySnapshot,
  UpdateSettingsRequest,
} from './remote-contract.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteMap {
    'missherMemory/snapshot': () => Promise<RemoteResult<MemorySnapshot>>
    'missherMemory/bindProject': (request: BindProjectRequest) => Promise<RemoteResult<MemorySnapshot>>
    'missherMemory/updateSettings': (request: UpdateSettingsRequest) => Promise<RemoteResult<MemorySnapshot>>
    'missherMemory/deleteProject': (request: DeleteProjectRequest) => Promise<RemoteResult<MemorySnapshot>>
    'missherMemory/reviewCandidate': (request: CandidateReviewRequest) => Promise<RemoteResult<MemorySnapshot>>
    'missherMemory/exportProject': (request: ExportProjectRequest) => Promise<RemoteResult<ExportProjectResult>>
  }

  interface TypertRemoteNamespaceMap {
    missherMemory: {
      snapshot: () => Promise<RemoteResult<MemorySnapshot>>
      bindProject: (request: BindProjectRequest) => Promise<RemoteResult<MemorySnapshot>>
      updateSettings: (request: UpdateSettingsRequest) => Promise<RemoteResult<MemorySnapshot>>
      deleteProject: (request: DeleteProjectRequest) => Promise<RemoteResult<MemorySnapshot>>
      reviewCandidate: (request: CandidateReviewRequest) => Promise<RemoteResult<MemorySnapshot>>
      exportProject: (request: ExportProjectRequest) => Promise<RemoteResult<ExportProjectResult>>
    }
  }
}

/** Typert Client contribution for memory RPC resolution. */
export const TYPERT_REMOTE = {
  package: 'dsh-missher-memory',
  descriptors: invocationDescriptors,
} as const satisfies TypertRemoteContribution

export default TYPERT_REMOTE
