import { describe, expect, it, vi } from 'vitest'
import { MemoryBrainProvider } from '../src/host/brain-provider.ts'

const project = {
  projectKey: 'prj_' + 'a'.repeat(32),
  basename: 'project',
  shortHash: '1234abcd',
  captureEnabled: true,
  recallEnabled: true,
  recallLimit: 3,
  recallByteBudget: 3_000,
  sessionKeys: ['legacy-session'],
}

const request = {
  projectKey: 'b'.repeat(64),
  sessionId: 'session-a',
  turn: 1,
  query: 'packaged smoke',
  signal: new AbortController().signal,
}

describe('MemoryBrainProvider', () => {
  it('prepares reviewed and legacy rows without mutating either source', async () => {
    const state = {
      lookupProject: vi.fn().mockResolvedValue({ status: 'bound', project }),
      searchApprovedMemories: vi.fn()
        .mockResolvedValueOnce([{
          memoryId: 'approved_123456789012345678901234',
          scope: 'project',
          kind: 'decision',
          content: 'Run packaged smoke before publishing.',
          sourceCandidateIds: ['candidate-a'],
          pinned: true,
          createdAt: '2026-08-20T00:00:00.000Z',
          updatedAt: '2026-08-21T00:00:00.000Z',
        }])
        .mockResolvedValueOnce([]),
      countApprovedMemories: vi.fn().mockResolvedValue(1),
      searchMemoryCapsules: vi.fn().mockResolvedValue([{
        capsuleId: 'capsule_123456789012345678901234',
        projectShortHash: '1234abcd',
        scope: 'project',
        kind: 'progress',
        topicKey: 'topic-a',
        content: 'The signed release passed repeated smoke checks.',
        sourceMemoryIds: ['approved_a', 'approved_b', 'approved_c', 'approved_d'],
        status: 'active',
        policyVersion: 1,
        checksum: 'c'.repeat(64),
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      }]),
    }
    const legacy = {
      search: vi.fn().mockResolvedValue({
        status: 'ready',
        results: [{
          excerpt: 'Run packaged smoke before publishing.',
          kind: 'decision',
          source: 'l1',
          recordedAt: '2026-08-19T00:00:00.000Z',
          reference: 'mem_1234567890abcdef',
        }],
        truncated: false,
        usedBytes: 42,
        rejectedSensitive: 0,
      }),
    }
    const provider = new MemoryBrainProvider({
      state: state as never,
      legacy,
      database: {},
      timeoutMs: 1_500,
    })
    provider.noteSession(request.sessionId, '/synthetic/project')

    const prepared = await provider.prepare(request)

    expect(prepared.items).toEqual([
      expect.objectContaining({
        handle: 'approved_123456789012345678901234',
        providerId: 'memory',
        kind: 'reviewed-memory',
        pinned: true,
      }),
      expect.objectContaining({
        handle: 'capsule_123456789012345678901234',
        providerId: 'memory',
        kind: 'memory-capsule',
      }),
      expect.objectContaining({
        handle: 'mem_1234567890abcdef',
        providerId: 'memory',
        kind: 'legacy-memory',
        pinned: false,
      }),
    ])
    await prepared.accept(['approved_123456789012345678901234'])
    expect(state.searchApprovedMemories).toHaveBeenCalledTimes(2)
    expect(legacy.search).toHaveBeenCalledOnce()
    await expect(provider.status()).resolves.toEqual({ state: 'ready', count: 1 })
  })

  it('returns no rows for an unknown session, disabled recall, sensitive query, or cancellation', async () => {
    const state = {
      lookupProject: vi.fn().mockResolvedValue({ status: 'bound', project: { ...project, recallEnabled: false } }),
      searchApprovedMemories: vi.fn(),
      countApprovedMemories: vi.fn().mockResolvedValue(0),
      searchMemoryCapsules: vi.fn(),
    }
    const legacy = { search: vi.fn() }
    const provider = new MemoryBrainProvider({ state: state as never, legacy, database: {}, timeoutMs: 1_500 })

    expect((await provider.prepare(request)).items).toEqual([])
    provider.noteSession(request.sessionId, '/synthetic/project')
    expect((await provider.prepare(request)).items).toEqual([])
    const sensitive = await provider.prepare({ ...request, query: 'password=synthetic-secret-value' })
    expect(sensitive.items).toEqual([])
    await sensitive.cancel()
    expect(state.searchApprovedMemories).not.toHaveBeenCalled()
    expect(legacy.search).not.toHaveBeenCalled()
    provider.forgetSession(request.sessionId)
  })
})
