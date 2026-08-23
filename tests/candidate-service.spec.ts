import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidateService } from '../src/host/candidate-service.ts'
import { StateStore } from '../src/host/state-store.ts'

const roots: string[] = []

async function stateFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-candidates-'))
  roots.push(root)
  const cwd = join(root, 'project')
  await mkdir(cwd)
  const store = new StateStore({ stateDirectory: join(root, 'dsh-home', 'missher-memory') })
  const bound = await store.bindProject({ cwd, sessionKeys: [] })
  if (bound.status !== 'bound') throw new Error('candidate fixture binding failed')
  return { root, cwd, store, project: bound.project }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

describe('deterministic candidate generation', () => {
  it('classifies architecture, decisions, failures, progress, and next steps without an LLM', async () => {
    const store = { createPendingCandidates: vi.fn().mockResolvedValue({ status: 'created', candidateIds: ['one'] }) }
    const service = new CandidateService(store as never)

    const result = await service.generate('prj_' + 'a'.repeat(32), 'session-a', [
      { role: 'user', text: '架构采用独立 Worker，决定不执行 Python。' },
      { role: 'assistant', text: '已完成只读搜索测试。' },
      { role: 'assistant', text: '失败经验：同步查询会阻塞。' },
      { role: 'assistant', text: '下一步完成 packaged smoke。' },
    ])

    expect(result).toEqual({ status: 'created', candidateIds: ['one'] })
    const drafts = store.createPendingCandidates.mock.calls[0]?.[2]
    expect(drafts.map((draft: { kind: string }) => draft.kind)).toEqual([
      'architecture',
      'progress',
      'failure',
      'next',
    ])
    expect(JSON.stringify(drafts)).not.toContain('session-a')
  })

  it('rejects a sensitive session before any state mutation', async () => {
    const store = { createPendingCandidates: vi.fn() }
    const service = new CandidateService(store as never)

    await expect(
      service.generate('prj_' + 'a'.repeat(32), 'session-a', [
        { role: 'user', text: 'password=synthetic-password-value' },
      ]),
    ).resolves.toEqual({ status: 'rejected-sensitive' })
    expect(store.createPendingCandidates).not.toHaveBeenCalled()
  })

  it('fails open when state persistence rejects the write', async () => {
    const store = { createPendingCandidates: vi.fn().mockRejectedValue(new Error('synthetic failure')) }
    const service = new CandidateService(store as never)

    await expect(
      service.generate('prj_' + 'a'.repeat(32), 'session-a', [{ role: 'assistant', text: '普通进度说明' }]),
    ).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('candidate review state', () => {
  it('creates idempotent pending candidates and supports edit, approve, pin, forget, and export', async () => {
    const { cwd, store, project } = await stateFixture()
    const drafts = [{ scope: 'project' as const, kind: 'decision' as const, content: 'Use a read-only Worker.' }]

    const first = await store.createPendingCandidates(project.projectKey, 'session-a', drafts)
    const repeated = await store.createPendingCandidates(project.projectKey, 'session-a', drafts)

    expect(first.status).toBe('created')
    expect(repeated).toEqual(first)
    if (first.status !== 'created') return
    const candidateId = first.candidateIds[0]!
    await expect(store.editCandidate(candidateId, { content: 'Use one deadline-controlled read-only Worker.' })).resolves.toEqual({
      status: 'updated',
    })
    await expect(
      store.editCandidate(candidateId, { content: 'api_key=sk-test-' + 'x'.repeat(32) }),
    ).resolves.toEqual({ status: 'rejected-sensitive' })
    await expect(store.approveCandidate(candidateId, {})).resolves.toMatchObject({
      status: 'approved',
      memoryId: expect.stringMatching(/^approved_[a-f0-9]{24}$/u),
    })
    await expect(store.setCandidatePinned(candidateId, true)).resolves.toEqual({ status: 'updated' })
    const approved = await store.listApprovedMemories({ projectKey: project.projectKey, scope: 'project' })
    expect(approved).toMatchObject([{ content: 'Use one deadline-controlled read-only Worker.', pinned: true }])
    const exported = await store.exportProject(project.projectKey)
    expect(exported.status).toBe('exported')
    expect(JSON.stringify(exported)).not.toContain(cwd)
    expect(JSON.stringify(exported)).not.toContain('session-a')
    await expect(store.forgetCandidate(candidateId)).resolves.toEqual({ status: 'forgotten' })
    await expect(store.listApprovedMemories({ projectKey: project.projectKey, scope: 'project' })).resolves.toEqual([])
  })

  it('merges pending candidates transactionally and preserves project isolation', async () => {
    const { store, project } = await stateFixture()
    const otherRoot = roots[roots.length - 1]!
    const otherCwd = join(otherRoot, 'other-project')
    await mkdir(otherCwd)
    const other = await store.bindProject({ cwd: otherCwd, sessionKeys: [] })
    if (other.status !== 'bound') throw new Error('other project binding failed')
    const one = await store.createPendingCandidates(project.projectKey, 'session-a', [
      { scope: 'project', kind: 'progress', content: 'Search tests pass.' },
      { scope: 'project', kind: 'next', content: 'Build the package.' },
    ])
    const foreign = await store.createPendingCandidates(other.project.projectKey, 'session-b', [
      { scope: 'project', kind: 'progress', content: 'Foreign project.' },
    ])
    if (one.status !== 'created' || foreign.status !== 'created') throw new Error('candidate creation failed')

    await expect(
      store.mergeCandidates([...one.candidateIds, foreign.candidateIds[0]!], {
        kind: 'progress',
        scope: 'project',
        content: 'Must not merge.',
      }),
    ).resolves.toEqual({ status: 'cross-project' })
    const merged = await store.mergeCandidates(one.candidateIds, {
      kind: 'progress',
      scope: 'project',
      content: 'Search tests pass; package build is next.',
    })
    expect(merged).toMatchObject({ status: 'merged', candidateId: expect.stringMatching(/^memcand_[a-f0-9]{24}$/u) })
    const candidates = await store.listCandidates(project.projectKey)
    expect(candidates.filter((candidate) => candidate.status === 'pending')).toHaveLength(1)
    expect(candidates.filter((candidate) => candidate.status === 'forgotten')).toHaveLength(2)
  })

  it('deletes personal memories derived from a deleted project instead of leaving unmanaged rows', async () => {
    const { store, project } = await stateFixture()
    const created = await store.createPendingCandidates(project.projectKey, 'session-a', [
      { scope: 'personal', kind: 'personal-preference', content: 'Prefer concise summaries.' },
    ])
    if (created.status !== 'created') throw new Error('candidate creation failed')
    await store.approveCandidate(created.candidateIds[0]!, {})
    await expect(store.listApprovedMemories({ projectKey: project.projectKey, scope: 'personal' })).resolves.toHaveLength(1)

    await store.deleteProject(project.projectKey)

    await expect(store.listApprovedMemories({ projectKey: project.projectKey, scope: 'personal' })).resolves.toEqual([])
  })
})
