import { describe, expect, it, vi } from 'vitest'
import { createMemorySearchTool } from '../src/host/memory-tool.ts'

function execution(cwd?: string) {
  return {
    agent: cwd === undefined ? undefined : { session: { header: { cwd } } },
    signal: new AbortController().signal,
  } as never
}

function boundProject() {
  return {
    status: 'bound' as const,
    project: {
      projectKey: 'prj_' + 'a'.repeat(32),
      basename: 'super-project',
      shortHash: '1234abcd',
      captureEnabled: false,
      recallEnabled: false,
      recallLimit: 3,
      recallByteBudget: 3000,
      sessionKeys: ['session-alpha'],
    },
  }
}

describe('memory_search tool', () => {
  it('requires a caller cwd and an explicit project binding', async () => {
    const state = { lookupProject: vi.fn().mockResolvedValue({ status: 'unbound' }) }
    const search = { search: vi.fn() }
    const tool = createMemorySearchTool({ state, search, database: {}, searchTimeoutMs: 1_500, searchByteBudget: 6_000 })

    await expect(tool.execute({ query: 'architecture' }, execution())).resolves.toMatchObject({
      status: 'caller-required',
      project: null,
      results: [],
    })
    await expect(tool.execute({ query: 'architecture' }, execution('/workspace/project'))).resolves.toMatchObject({
      status: 'project-unbound',
      project: null,
      results: [],
    })
    expect(search.search).not.toHaveBeenCalled()
  })

  it('searches only decrypted source keys from the authoritative binding', async () => {
    const state = { lookupProject: vi.fn().mockResolvedValue(boundProject()) }
    const search = {
      search: vi.fn().mockResolvedValue({
        status: 'ready',
        results: [
          {
            excerpt: 'Use a Worker for the read-only database.',
            kind: 'decision',
            source: 'l1',
            recordedAt: '2026-08-01T10:00:00Z',
            reference: 'mem_0123456789abcdef',
          },
        ],
        truncated: false,
        usedBytes: 40,
        rejectedSensitive: 0,
      }),
    }
    const tool = createMemorySearchTool({ state, search, database: {}, searchTimeoutMs: 1_500, searchByteBudget: 6_000 })

    const result = await tool.execute({ query: 'Worker', limit: 4, scope: 'project' }, execution('/workspace/project'))

    expect(search.search).toHaveBeenCalledWith({
      database: {},
      sessionKeys: ['session-alpha'],
      query: 'Worker',
      limit: 4,
      maxBytes: 6_000,
      timeoutMs: 1_500,
    })
    expect(result).toEqual({
      status: 'ready',
      scope: 'project',
      project: { basename: 'super-project', shortHash: '1234abcd' },
      results: [
        {
          excerpt: 'Use a Worker for the read-only database.',
          kind: 'decision',
          source: 'l1',
          recordedAt: '2026-08-01T10:00:00Z',
          reference: 'mem_0123456789abcdef',
        },
      ],
      truncated: false,
      usedBytes: 40,
      rejectedSensitive: 0,
    })
    expect(JSON.stringify(result)).not.toContain('/workspace')
    expect(JSON.stringify(result)).not.toContain('session-alpha')
  })

  it('renders source, time, and reference while declaring a generic search card', async () => {
    const state = { lookupProject: vi.fn().mockResolvedValue(boundProject()) }
    const search = {
      search: vi.fn().mockResolvedValue({
        status: 'ready',
        results: [
          {
            excerpt: 'Next step is packaged smoke.',
            kind: 'next',
            source: 'l1',
            recordedAt: '2026-08-02T10:00:00Z',
            reference: 'mem_fedcba9876543210',
          },
        ],
        truncated: false,
        usedBytes: 28,
        rejectedSensitive: 0,
      }),
    }
    const tool = createMemorySearchTool({ state, search, database: {}, searchTimeoutMs: 1_500, searchByteBudget: 6_000 })
    const value = await tool.execute({ query: 'next' }, execution('/workspace/project'))

    expect(tool.presentCall?.({ query: 'next' })).toEqual({
      card: 'generic',
      title: 'Search project memory',
      kind: 'search',
      rawInput: { query: 'next', scope: 'project', limit: 5 },
    })
    const rendered = tool.output.render({ query: 'next' }, value as never)
    expect(rendered).toHaveLength(1)
    expect(rendered[0]).toMatchObject({ type: 'text' })
    expect((rendered[0] as { text: string }).text).toContain('[l1 · 2026-08-02T10:00:00Z · mem_fedcba9876543210]')
  })

  it('keeps personal scope isolated from the external project database', async () => {
    const state = { lookupProject: vi.fn().mockResolvedValue(boundProject()) }
    const search = { search: vi.fn() }
    const tool = createMemorySearchTool({ state, search, database: {}, searchTimeoutMs: 1_500, searchByteBudget: 6_000 })

    await expect(tool.execute({ query: 'preference', scope: 'personal' }, execution('/workspace/project'))).resolves.toEqual({
      status: 'ready',
      scope: 'personal',
      project: { basename: 'super-project', shortHash: '1234abcd' },
      results: [],
      truncated: false,
      usedBytes: 0,
      rejectedSensitive: 0,
    })
    expect(search.search).not.toHaveBeenCalled()
  })

  it('searches approved personal memory without touching the project database', async () => {
    const state = {
      lookupProject: vi.fn().mockResolvedValue(boundProject()),
      listApprovedMemories: vi.fn().mockResolvedValue([
        {
          memoryId: 'approved_123456789012345678901234',
          scope: 'personal',
          kind: 'personal-preference',
          content: 'Preference: keep responses concise.',
          sourceCandidateIds: ['memcand_1'],
          pinned: true,
          createdAt: '2026-08-01T10:00:00Z',
          updatedAt: '2026-08-02T10:00:00Z',
        },
      ]),
    }
    const search = { search: vi.fn() }
    const tool = createMemorySearchTool({ state, search, database: {}, searchTimeoutMs: 1_500, searchByteBudget: 6_000 })

    await expect(tool.execute({ query: 'concise', scope: 'personal' }, execution('/workspace/project'))).resolves.toMatchObject({
      status: 'ready',
      scope: 'personal',
      results: [{ source: 'approved personal memory', reference: 'approved_123456789012345678901234' }],
    })
    expect(search.search).not.toHaveBeenCalled()
  })

  it('applies the deployment result cap below the immutable hard maximum', async () => {
    const state = { lookupProject: vi.fn().mockResolvedValue(boundProject()) }
    const search = { search: vi.fn().mockResolvedValue({ status: 'ready', results: [], truncated: false, usedBytes: 0, rejectedSensitive: 0 }) }
    const tool = createMemorySearchTool({
      state,
      search,
      database: {},
      searchTimeoutMs: 1_500,
      searchByteBudget: 6_000,
      maxSearchResults: 3,
    })

    await tool.execute({ query: 'architecture', limit: 9 }, execution('/workspace/project'))

    expect(search.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }))
  })
})
