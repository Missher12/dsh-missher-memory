import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConsolidationService } from '../src/host/consolidation-service.ts'
import { selectConsolidationGroups } from '../src/host/consolidation-policy.ts'
import { StateStore, type ConsolidationAtom } from '../src/host/state-store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function atom(overrides: Partial<ConsolidationAtom> = {}): ConsolidationAtom {
  return {
    memoryId: 'approved_default',
    projectKey: 'prj_a',
    scope: 'project',
    kind: 'progress',
    content: 'Native packaged smoke passed.',
    pinned: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('reversible reviewed-memory consolidation', () => {
  it('excludes recent, pinned, cross-project, and incompatible atoms', () => {
    const eligible = Array.from({ length: 4 }, (_, index) => atom({ memoryId: `approved_old_${index}` }))
    const groups = selectConsolidationGroups([
      ...eligible,
      atom({ memoryId: 'approved_pinned', pinned: true }),
      atom({ memoryId: 'approved_recent', createdAt: '2026-08-23T00:00:00.000Z' }),
      atom({ memoryId: 'approved_other_project', projectKey: 'prj_b' }),
      atom({ memoryId: 'approved_other_kind', kind: 'decision' }),
    ], { now: Date.parse('2026-08-24T00:00:00.000Z'), minimumAgeMs: 7 * 86_400_000, minimumSources: 4 })

    expect(groups).toEqual([expect.objectContaining({
      projectKey: 'prj_a',
      sourceMemoryIds: eligible.map(item => item.memoryId),
      content: 'Native packaged smoke passed.',
    })])
  })

  it('archives duplicate atoms into one capsule and rolls them back exactly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-consolidate-'))
    roots.push(root)
    const cwd = join(root, 'project')
    const stateDirectory = join(root, 'state')
    await mkdir(cwd)
    const store = new StateStore({ stateDirectory })
    const bound = await store.bindProject({ cwd, sessionKeys: [] })
    if (bound.status !== 'bound') throw new Error('fixture binding failed')
    for (let index = 0; index < 4; index += 1) {
      const created = await store.createPendingCandidates(bound.project.projectKey, `session-${index}`, [{
        scope: 'project', kind: 'progress', content: 'Native packaged smoke passed.',
      }])
      if (created.status !== 'created') throw new Error('candidate fixture failed')
      await store.approveCandidate(created.candidateIds[0]!, {})
    }
    const database = new DatabaseSync(join(stateDirectory, 'state.db'))
    database.prepare(`
      UPDATE approved_memories SET created_at = ?, updated_at = ? WHERE project_key = ?
    `).run('2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', bound.project.projectKey)
    database.close()
    const service = new ConsolidationService({ store, now: () => Date.parse('2026-08-24T00:00:00.000Z') })

    const result = await service.runProject(bound.project.projectKey, 'manual')

    expect(result).toMatchObject({ status: 'consolidated', inputCount: 4, outputCount: 1 })
    if (result.status !== 'consolidated') throw new Error('expected consolidation')
    await expect(store.listApprovedMemories({ projectKey: bound.project.projectKey, scope: 'project' }))
      .resolves.toEqual([])
    await expect(store.listMemoryCapsules({ projectKey: bound.project.projectKey, scope: 'project' }))
      .resolves.toEqual([expect.objectContaining({
        capsuleId: result.capsuleIds[0],
        content: 'Native packaged smoke passed.',
        sourceMemoryIds: expect.arrayContaining([expect.stringMatching(/^approved_/u)]),
        status: 'active',
      })])

    await expect(store.rollbackCapsule(result.capsuleIds[0]!)).resolves.toEqual({ status: 'rolled-back' })
    await expect(store.listApprovedMemories({ projectKey: bound.project.projectKey, scope: 'project' }))
      .resolves.toHaveLength(4)
    await expect(store.listMemoryCapsules({ projectKey: bound.project.projectKey, scope: 'project' }))
      .resolves.toEqual([expect.objectContaining({ status: 'superseded' })])
  })
})
