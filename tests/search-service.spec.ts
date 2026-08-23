import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReaderWorker } from '../src/host/reader-worker.ts'
import { MemorySearchService } from '../src/host/search-service.ts'
import { createMemoryDatabase } from './fixtures/create-memory-db.ts'

const roots: string[] = []

async function databaseRoot(): Promise<{ base: string; root: string; path: string }> {
  const base = await mkdtemp(join(tmpdir(), 'dsh-memory-search-'))
  roots.push(base)
  const root = join(base, 'memory')
  await mkdir(root)
  return { base, root, path: join(root, 'vectors.db') }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

describe('project-scoped memory search', () => {
  it('returns only base-table rows from explicitly allowed session keys', async () => {
    const fixture = await databaseRoot()
    createMemoryDatabase(fixture.path, [
      {
        recordId: 'a-l1',
        sessionKey: 'project-a',
        content: 'alpha architecture decision',
        kind: 'decision',
        recordedAt: '2026-08-01T10:00:00Z',
        source: 'l1',
      },
      {
        recordId: 'a-l0',
        sessionKey: 'project-a',
        content: 'alpha progress update',
        recordedAt: '2026-08-02T10:00:00Z',
        source: 'l0',
      },
      {
        recordId: 'b-l1',
        sessionKey: 'project-b',
        content: 'alpha private other project',
        source: 'l1',
      },
    ])
    const database = new (await import('node:sqlite')).DatabaseSync(fixture.path)
    database.prepare('INSERT INTO l1_fts (record_id, content) VALUES (?, ?)').run('orphan', 'alpha orphan')
    database.close()
    const reader = new ReaderWorker({ workerUrl: new URL('../src/workers/sqlite-reader.worker.ts', import.meta.url) })
    const service = new MemorySearchService(reader)

    const result = await service.search({
      database: { overrideRoot: fixture.root, homeDirectory: fixture.base },
      sessionKeys: ['project-a'],
      query: 'alpha',
      limit: 5,
      maxBytes: 2_000,
      timeoutMs: 1_000,
    })

    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.results.map((row) => row.excerpt).sort()).toEqual([
        'alpha architecture decision',
        'alpha progress update',
      ])
      expect(result.results.map((row) => row.source).sort()).toEqual(['l0', 'l1'])
      expect(result.results.every((row) => /^mem_[a-f0-9]{16}$/u.test(row.reference))).toBe(true)
      expect(JSON.stringify(result)).not.toContain('project-a')
      expect(JSON.stringify(result)).not.toContain('project-b')
      expect(JSON.stringify(result)).not.toContain('orphan')
    }
    await reader.close()
  })

  it('treats SQL and FTS operators as literal query tokens', async () => {
    const fixture = await databaseRoot()
    createMemoryDatabase(fixture.path, [
      { recordId: 'a', sessionKey: 'project-a', content: 'alpha beta', source: 'l1' },
      { recordId: 'b', sessionKey: 'project-b', content: 'alpha OR beta', source: 'l1' },
    ])
    const reader = new ReaderWorker({ workerUrl: new URL('../src/workers/sqlite-reader.worker.ts', import.meta.url) })
    const service = new MemorySearchService(reader)

    const result = await service.search({
      database: { overrideRoot: fixture.root, homeDirectory: fixture.base },
      sessionKeys: ['project-a'],
      query: 'alpha OR beta -- DROP TABLE l1_records',
      limit: 5,
      maxBytes: 2_000,
      timeoutMs: 1_000,
    })

    expect(result).toMatchObject({ status: 'ready', results: [] })
    await reader.close()
  })

  it('drops sensitive rows before applying the public result budget', async () => {
    const fixture = await databaseRoot()
    createMemoryDatabase(fixture.path, [
      { recordId: 'safe', sessionKey: 'project-a', content: 'alpha safe progress', source: 'l1' },
      {
        recordId: 'secret',
        sessionKey: 'project-a',
        content: 'alpha api_key=sk-test-' + 'x'.repeat(32),
        source: 'l1',
      },
    ])
    const reader = new ReaderWorker({ workerUrl: new URL('../src/workers/sqlite-reader.worker.ts', import.meta.url) })
    const service = new MemorySearchService(reader)

    const result = await service.search({
      database: { overrideRoot: fixture.root, homeDirectory: fixture.base },
      sessionKeys: ['project-a'],
      query: 'alpha',
      limit: 5,
      maxBytes: 8,
      timeoutMs: 1_000,
    })

    expect(result).toEqual({
      status: 'ready',
      results: [
        {
          excerpt: 'alpha sa',
          kind: 'memory',
          source: 'l1',
          recordedAt: null,
          reference: expect.stringMatching(/^mem_[a-f0-9]{16}$/u),
        },
      ],
      truncated: true,
      usedBytes: 8,
      rejectedSensitive: 1,
    })
    await reader.close()
  })

  it('fails open for unconfigured, corrupt, incompatible, and empty project mappings', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-memory-missing-'))
    roots.push(home)
    const corrupt = await databaseRoot()
    await writeFile(corrupt.path, 'not sqlite bytes')
    const incompatible = await databaseRoot()
    const database = new (await import('node:sqlite')).DatabaseSync(incompatible.path)
    database.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
    database.close()
    const reader = new ReaderWorker({ workerUrl: new URL('../src/workers/sqlite-reader.worker.ts', import.meta.url) })
    const service = new MemorySearchService(reader)
    const baseRequest = { sessionKeys: ['project-a'], query: 'alpha', limit: 5, maxBytes: 2_000, timeoutMs: 1_000 }

    await expect(service.search({ ...baseRequest, database: { homeDirectory: home } })).resolves.toEqual({
      status: 'not-configured',
    })
    await expect(
      service.search({ ...baseRequest, database: { overrideRoot: corrupt.root, homeDirectory: corrupt.base } }),
    ).resolves.toEqual({ status: 'corrupt' })
    await expect(
      service.search({ ...baseRequest, database: { overrideRoot: incompatible.root, homeDirectory: incompatible.base } }),
    ).resolves.toEqual({ status: 'incompatible' })
    await expect(
      service.search({ ...baseRequest, sessionKeys: [], database: { overrideRoot: incompatible.root } }),
    ).resolves.toEqual({ status: 'project-unbound' })
    await reader.close()
  })
})
