import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import TYPERT_REMOTE from '../typert.remote-client.js'
import type {
  BindProjectRequest,
  CandidateReviewRequest,
  DeleteProjectRequest,
  ExportProjectRequest,
  ExportProjectResult,
  MemorySnapshot,
  UpdateSettingsRequest,
} from '../remote-contract.js'
import { MemorySection, type MemorySectionProps } from './MemorySection.js'
import './contract.js'
import { en, zh } from './locales.js'

const NS = 'settings.missherMemory'

/** Services required by the native settings contribution and mounted Remote face. */
export const inject = ['slots', 'locale', 'remote']

/** Mounts the bundle-owned RPC descriptors and contributes one Harness Settings section. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const unmountRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  const remote = ctx.get('remote.missherMemory') as {
    snapshot: () => Promise<RemoteResult<MemorySnapshot>>
    bindProject: (request: BindProjectRequest) => Promise<RemoteResult<MemorySnapshot>>
    updateSettings: (request: UpdateSettingsRequest) => Promise<RemoteResult<MemorySnapshot>>
    deleteProject: (request: DeleteProjectRequest) => Promise<RemoteResult<MemorySnapshot>>
    reviewCandidate: (request: CandidateReviewRequest) => Promise<RemoteResult<MemorySnapshot>>
    exportProject: (request: ExportProjectRequest) => Promise<RemoteResult<ExportProjectResult>>
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'missher-memory: client dictionaries')
  const t = ctx.locale.bind(NS) as MemorySectionProps['t']
  const injected = (): MemorySectionProps => ({
    load: async () => unwrap(await remote.snapshot()),
    bindProject: async request => unwrap(await remote.bindProject(request)),
    updateSettings: async request => unwrap(await remote.updateSettings(request)),
    deleteProject: async request => unwrap(await remote.deleteProject(request)),
    reviewCandidate: async request => unwrap(await remote.reviewCandidate(request)),
    exportProject: async request => unwrap(await remote.exportProject(request)),
    t,
  })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'missher-memory',
    order: 14,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, MemorySection))
  return unmountRemote
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw new Error('missher-memory operation failed')
}

export { MemorySection } from './MemorySection.js'
export type { MemorySectionProps } from './MemorySection.js'
