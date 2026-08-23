import { mkdtemp, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryCoordinator } from '../src/host/coordinator.ts'
import { createMemoryDatabase } from './fixtures/create-memory-db.ts'

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-coordinator-'))
  roots.push(root)
  const cwd = join(root, 'super-project')
  await mkdir(cwd)
  const project = {
    projectKey: 'prj_' + 'a'.repeat(32),
    basename: 'super-project',
    shortHash: '1234abcd',
    captureEnabled: false,
    recallEnabled: false,
    recallLimit: 3,
    recallByteBudget: 3000,
    sessionKeys: ['session-alpha'],
  }
  const state = {
    lookupProject: vi.fn().mockResolvedValue({ status: 'unbound' }),
    bindProject: vi.fn().mockResolvedValue({ status: 'bound', project }),
    updateSettings: vi.fn().mockResolvedValue({ status: 'updated' }),
    deleteProject: vi.fn().mockResolvedValue({ status: 'deleted' }),
    listCandidates: vi.fn().mockResolvedValue([]),
    listApprovedMemories: vi.fn().mockResolvedValue([]),
  }
  return { root, cwd, project, state }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

describe('pathless Host coordinator', () => {
  it('keeps cwd only in memory and returns an opaque candidate', async () => {
    const { root, cwd, state } = await fixture()
    const coordinator = new MemoryCoordinator({ state: state as never, database: { homeDirectory: root } })

    await coordinator.noteCwd(cwd)
    const snapshot = await coordinator.snapshot()

    expect(snapshot.projectCandidate).toEqual({
      candidateId: expect.stringMatching(/^cand_[a-f0-9]{16}$/u),
      basename: 'super-project',
      shortHash: expect.stringMatching(/^[a-f0-9]{8}$/u),
    })
    expect(snapshot.database).toEqual({ status: 'not-configured', source: 'default' })
    expect(JSON.stringify(snapshot)).not.toContain(cwd)
  })

  it('resolves only known opaque candidate and source handles during binding', async () => {
    const { root, cwd, project, state } = await fixture()
    state.lookupProject.mockResolvedValue({ status: 'bound', project })
    const coordinator = new MemoryCoordinator({ state: state as never, database: { homeDirectory: root } })
    await coordinator.noteCwd(cwd)
    coordinator.noteSource({
      sessionKey: 'session-alpha',
      recordCount: 12,
      firstAt: '2026-07-01T00:00:00Z',
      lastAt: '2026-08-01T00:00:00Z',
    })
    const before = await coordinator.snapshot()
    const candidateId = before.projectCandidate?.candidateId
    const sourceId = before.sources[0]?.sourceId
    expect(candidateId).toBeDefined()
    expect(sourceId).toBeDefined()

    const after = await coordinator.bindProject({ candidateId: candidateId!, sourceIds: [sourceId!] })

    expect(state.bindProject).toHaveBeenCalledWith({ cwd: await realpath(cwd), sessionKeys: ['session-alpha'] })
    expect(after.project).toEqual({
      projectKey: project.projectKey,
      basename: project.basename,
      shortHash: project.shortHash,
      captureEnabled: false,
      recallEnabled: false,
      recallLimit: 3,
      recallByteBudget: 3000,
    })
    expect(JSON.stringify(after)).not.toContain('session-alpha')
  })

  it('rejects stale or invented handles before any state mutation', async () => {
    const { root, state } = await fixture()
    const coordinator = new MemoryCoordinator({ state: state as never, database: { homeDirectory: root } })

    await expect(
      coordinator.bindProject({ candidateId: 'cand_0123456789abcdef', sourceIds: [] }),
    ).rejects.toThrow('unknown_candidate')
    expect(state.bindProject).not.toHaveBeenCalled()
  })

  it('refreshes structural sources and candidate counts without exposing source identities', async () => {
    const { root, cwd, project, state } = await fixture()
    state.lookupProject.mockResolvedValue({ status: 'bound', project })
    state.listCandidates.mockResolvedValue([
      {
        candidateId: 'memcand_' + '1'.repeat(24),
        projectShortHash: project.shortHash,
        scope: 'project',
        kind: 'next',
        content: 'Run packaged smoke.',
        status: 'pending',
        pinned: false,
        createdAt: '2026-08-22T00:00:00Z',
        updatedAt: '2026-08-22T00:00:00Z',
      },
    ])
    state.listApprovedMemories.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}])
    const discovery = {
      discover: vi.fn().mockResolvedValue({
        status: 'ready',
        sources: [{ sessionKey: 'session-alpha', recordCount: 12, firstAt: null, lastAt: null }],
      }),
    }
    const memoryRoot = join(root, '.local', 'share', 'missher-memory', 'tencentdb')
    await mkdir(memoryRoot, { recursive: true })
    createMemoryDatabase(join(memoryRoot, 'vectors.db'), [])
    const coordinator = new MemoryCoordinator({
      state: state as never,
      database: { homeDirectory: root },
      discovery,
    })
    await coordinator.noteCwd(cwd)
    const snapshot = await coordinator.snapshot()

    expect(snapshot.candidates).toMatchObject([{ candidateId: 'memcand_' + '1'.repeat(24), kind: 'next' }])
    expect(snapshot.approvedCount).toBe(2)
    expect(snapshot.sources).toMatchObject([{ recordCount: 12, bound: true }])
    expect(JSON.stringify(snapshot)).not.toContain('session-alpha')
  })
})
