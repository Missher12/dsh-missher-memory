import { DatabaseSync } from 'node:sqlite'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from '../src/host/state-store.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function legacyFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-schema-'))
  roots.push(root)
  const cwd = join(root, 'project')
  const stateDirectory = join(root, 'dsh-home', 'missher-memory')
  await mkdir(cwd)
  const store = new StateStore({ stateDirectory })
  const bound = await store.bindProject({ cwd, sessionKeys: ['legacy-session'] })
  if (bound.status !== 'bound') throw new Error('fixture bind failed')
  const created = await store.createPendingCandidates(bound.project.projectKey, 'capture-session', [{
    scope: 'project',
    kind: 'decision',
    content: 'The release must preserve exact public artifact bytes.',
  }])
  if (created.status !== 'created') throw new Error('fixture candidate failed')
  await store.approveCandidate(created.candidateIds[0]!, {})

  const databasePath = join(stateDirectory, 'state.db')
  const database = new DatabaseSync(databasePath)
  database.exec('DROP TABLE IF EXISTS memory_capsules; DROP TABLE IF EXISTS maintenance_runs; DROP TABLE IF EXISTS approved_memory_fts; DROP TABLE IF EXISTS memory_capsule_fts;')
  const columns = database.prepare('PRAGMA table_info(approved_memories)').all() as unknown as Array<{ name: string }>
  if (columns.some(column => column.name === 'lifecycle_state')) {
    database.exec('ALTER TABLE approved_memories DROP COLUMN lifecycle_state')
  }
  database.exec('PRAGMA user_version = 1')
  const before = database.prepare(`
    SELECT m.content, m.sources_json, b.session_ciphertext
    FROM approved_memories AS m CROSS JOIN bindings AS b
    LIMIT 1
  `).get()
  database.close()
  return { cwd, stateDirectory, databasePath, before }
}

describe('schema two migration', () => {
  it('migrates v1 atoms and bindings transactionally without changing their bytes', async () => {
    const fixture = await legacyFixture()
    const reopened = new StateStore({ stateDirectory: fixture.stateDirectory })

    await expect(reopened.lookupProject(fixture.cwd)).resolves.toMatchObject({ status: 'bound' })

    const bound = await reopened.lookupProject(fixture.cwd)
    if (bound.status !== 'bound') throw new Error('migration failed')
    expect(await reopened.searchApprovedMemories({ projectKey: bound.project.projectKey, scope: 'project', query: 'artifact', limit: 5 })).toHaveLength(1)

    const database = new DatabaseSync(fixture.databasePath, { readOnly: true })
    expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    expect(database.prepare(`
      SELECT m.content, m.sources_json, b.session_ciphertext
      FROM approved_memories AS m CROSS JOIN bindings AS b
      LIMIT 1
    `).get()).toEqual(fixture.before)
    expect(database.prepare('SELECT lifecycle_state FROM approved_memories').get())
      .toEqual({ lifecycle_state: 'active' })
    const tables = database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name IN ('memory_capsules', 'maintenance_runs')
      ORDER BY name
    `).all()
    expect(tables).toEqual([{ name: 'maintenance_runs' }, { name: 'memory_capsules' }])
    database.close()
  })

  it('creates new state directly at schema two', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-memory-schema-new-'))
    roots.push(root)
    const cwd = join(root, 'project')
    const stateDirectory = join(root, 'state')
    await mkdir(cwd)
    const store = new StateStore({ stateDirectory })

    await expect(store.bindProject({ cwd, sessionKeys: [] })).resolves.toMatchObject({ status: 'bound' })
    const database = new DatabaseSync(join(stateDirectory, 'state.db'), { readOnly: true })
    expect((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    database.close()
  })
})

it('rolls back a failed v1 migration without changing source data or schema version', async () => {
  const f = await legacyFixture()
  const database = new DatabaseSync(f.databasePath)
  database.exec('CREATE TABLE memory_capsules (sentinel TEXT)')
  database.close()
  expect(await new StateStore({ stateDirectory: f.stateDirectory }).lookupProject(f.cwd))
    .toEqual({ status: 'incompatible-state' })
  const reopened = new DatabaseSync(f.databasePath, { readOnly: true })
  try {
    expect(reopened.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 })
    expect(reopened.prepare('PRAGMA table_info(approved_memories)').all().some(row => row.name === 'lifecycle_state')).toBe(false)
    expect(reopened.prepare(`SELECT m.content, m.sources_json, b.session_ciphertext
      FROM approved_memories AS m CROSS JOIN bindings AS b LIMIT 1`).get()).toEqual(f.before)
  } finally { reopened.close() }
})
