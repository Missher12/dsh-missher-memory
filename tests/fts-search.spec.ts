import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterEach, describe, expect, it } from 'vitest'
import { memorySearchTerms } from '../src/host/fts-index.ts'
import { StateStore } from '../src/host/state-store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function boundFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-fts-'))
  roots.push(root)
  const cwd = join(root, 'project')
  const stateDirectory = join(root, 'state')
  await mkdir(cwd)
  const store = new StateStore({ stateDirectory })
  const bound = await store.bindProject({ cwd, sessionKeys: [] })
  if (bound.status !== 'bound') throw new Error('fixture binding failed')
  return { root, cwd, stateDirectory, store, projectKey: bound.project.projectKey }
}

async function approve(
  store: StateStore,
  projectKey: string,
  source: string,
  content: string,
  scope: 'project' | 'personal' = 'project',
) {
  const created = await store.createPendingCandidates(projectKey, source, [{ scope, kind: 'decision', content }])
  if (created.status !== 'created') throw new Error('candidate creation failed')
  await store.approveCandidate(created.candidateIds[0]!, {})
}

describe('indexed reviewed memory', () => {
  it('searches mixed Chinese and English terms without scanning another project', async () => {
    const fixture = await boundFixture()
    await approve(fixture.store, fixture.projectKey, 'one', '架构边界要求 TencentDB 永远只读。')
    await approve(fixture.store, fixture.projectKey, 'two', 'Run packaged smoke before publishing the release.')

    await expect(fixture.store.searchApprovedMemories({
      projectKey: fixture.projectKey, scope: 'project', query: '架构边界', limit: 5,
    })).resolves.toMatchObject([{ content: expect.stringContaining('TencentDB') }])
    await expect(fixture.store.searchApprovedMemories({
      projectKey: fixture.projectKey, scope: 'project', query: 'packaged smoke', limit: 5,
    })).resolves.toMatchObject([{ content: expect.stringContaining('publishing') }])
  })

  it('keeps 50,000 reviewed atoms within the Intel p95 query budget', async () => {
    const fixture = await boundFixture()
    const database = new DatabaseSync(join(fixture.stateDirectory, 'state.db'))
    const insertMemory = database.prepare(`
      INSERT INTO approved_memories
        (memory_id, project_key, scope, kind, content, sources_json, pinned, lifecycle_state, created_at, updated_at)
      VALUES (?, ?, 'project', 'progress', ?, '[]', 0, 'active', ?, ?)
    `)
    const insertFts = database.prepare('INSERT INTO approved_memory_fts (memory_id, terms) VALUES (?, ?)')
    database.exec('BEGIN IMMEDIATE')
    for (let index = 0; index < 50_000; index += 1) {
      const id = `approved_seed_${String(index).padStart(12, '0')}`
      const content = index % 997 === 0
        ? `架构边界 retry policy verified sample ${index}`
        : `ordinary historical progress record ${index}`
      const timestamp = new Date(1_700_000_000_000 + index).toISOString()
      insertMemory.run(id, fixture.projectKey, content, timestamp, timestamp)
      insertFts.run(id, memorySearchTerms(content))
    }
    database.exec('COMMIT')
    database.close()

    const samples: number[] = []
    for (let index = 0; index < 40; index += 1) {
      const started = performance.now()
      const rows = await fixture.store.searchApprovedMemories({
        projectKey: fixture.projectKey,
        scope: 'project',
        query: index % 2 === 0 ? '架构边界' : 'retry policy',
        limit: 10,
      })
      samples.push(performance.now() - started)
      expect(rows.length).toBeGreaterThan(0)
    }
    samples.sort((left, right) => left - right)
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(150)
  }, 30_000)
})
