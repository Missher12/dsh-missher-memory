import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BindProjectRequestSchema,
  CandidateReviewRequestSchema,
  MemorySnapshotSchema,
  UpdateSettingsRequestSchema,
  invocationDescriptors,
  type MemorySnapshot,
} from '../src/remote-contract.ts'
import { MissherMemoryRemote } from '../src/remote.ts'
import { TYPERT } from '../src/typert.host.ts'
import { TYPERT_REMOTE } from '../src/typert.remote-client.ts'

const contexts: Context[] = []

function snapshot(): MemorySnapshot {
  return {
    schemaVersion: 1,
    database: { status: 'not-configured', source: 'default' },
    projectCandidate: {
      candidateId: 'cand_0123456789abcdef',
      basename: 'super-project',
      shortHash: '1234abcd',
    },
    project: null,
    projects: [],
    sources: [],
    candidates: [],
    approvedCount: 0,
  }
}

function service(overrides: Record<string, unknown> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const backend = {
    snapshot: vi.fn().mockResolvedValue(snapshot()),
    bindProject: vi.fn().mockResolvedValue(snapshot()),
    updateSettings: vi.fn().mockResolvedValue(snapshot()),
    deleteProject: vi.fn().mockResolvedValue(snapshot()),
    reviewCandidate: vi.fn().mockResolvedValue(snapshot()),
    exportProject: vi.fn().mockResolvedValue({ fileName: 'missher-memory-super-project-1234abcd.json', content: '{}' }),
    ...overrides,
  }
  return { backend, remote: new MissherMemoryRemote(ctx, backend as never) }
}

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('Missher memory Host RPC', () => {
  it('returns strict pathless snapshots', async () => {
    const { remote } = service()
    const result = await remote.snapshot()

    expect(MemorySnapshotSchema.parse(result)).toEqual(result)
    expect(JSON.stringify(result)).not.toMatch(/\/Users\/|sessionKey|cwd/iu)
    expect(MemorySnapshotSchema.safeParse({ ...result, cwd: '/private/project' }).success).toBe(false)
  })

  it('supports invocation through the Cordis service proxy', async () => {
    const { remote } = service()
    const ctx = contexts.at(-1)
    if (ctx === undefined) throw new Error('context missing')

    await expect(ctx.missherMemory.snapshot()).resolves.toEqual(await remote.snapshot())
  })

  it('accepts only opaque discovery handles for explicit binding', async () => {
    const { backend, remote } = service()
    const request = {
      candidateId: 'cand_0123456789abcdef',
      sourceIds: ['src_fedcba9876543210'],
    }

    await expect(remote.bindProject(request)).resolves.toEqual(snapshot())
    expect(backend.bindProject).toHaveBeenCalledWith(request)
    await expect(remote.bindProject({ ...request, cwd: '/private/project' } as never)).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(BindProjectRequestSchema.safeParse(request).success).toBe(true)
  })

  it('requires a strict explicit settings request', async () => {
    const { backend, remote } = service()
    const request = { projectKey: 'prj_' + 'a'.repeat(32), captureEnabled: true }

    await expect(remote.updateSettings(request)).resolves.toEqual(snapshot())
    expect(backend.updateSettings).toHaveBeenCalledWith(request)
    expect(UpdateSettingsRequestSchema.safeParse({ projectKey: request.projectKey }).success).toBe(false)
    expect(UpdateSettingsRequestSchema.safeParse({ ...request, recallLimit: 99 }).success).toBe(false)
  })

  it('replaces internal paths and secrets with a stable public error', async () => {
    const { remote } = service({
      bindProject: vi.fn().mockRejectedValue(new Error('failed /Users/example/private api_key=synthetic-secret')),
    })

    await expect(
      remote.bindProject({ candidateId: 'cand_0123456789abcdef', sourceIds: [] }),
    ).rejects.toMatchObject({ code: 'memory_operation_failed', message: 'memory_operation_failed' })
  })

  it('accepts only strict candidate review actions and pathless exports', async () => {
    const { backend, remote } = service()
    const review = { action: 'approve' as const, candidateId: 'memcand_' + '1'.repeat(24) }

    await expect(remote.reviewCandidate(review)).resolves.toEqual(snapshot())
    expect(backend.reviewCandidate).toHaveBeenCalledWith(review)
    expect(CandidateReviewRequestSchema.safeParse({ ...review, cwd: '/private/project' }).success).toBe(false)
    await expect(remote.exportProject({ projectKey: 'prj_' + 'a'.repeat(32) })).resolves.toEqual({
      fileName: 'missher-memory-super-project-1234abcd.json',
      content: '{}',
    })
  })

  it('shares strict descriptors across Host and Client faces', async () => {
    const { remote } = service()

    expect(TYPERT.invocations).toBe(invocationDescriptors)
    expect(TYPERT_REMOTE.descriptors).toBe(invocationDescriptors)
    expect(TYPERT_REMOTE.package).toBe('dsh-missher-memory')
    expect(remoteMethods(remote)).toEqual([
      { method: 'snapshot', invocation: { kind: 'direct' } },
      { method: 'bindProject', invocation: { kind: 'direct' } },
      { method: 'updateSettings', invocation: { kind: 'direct' } },
      { method: 'deleteProject', invocation: { kind: 'direct' } },
      { method: 'reviewCandidate', invocation: { kind: 'direct' } },
      { method: 'exportProject', invocation: { kind: 'direct' } },
    ])
  })
})
