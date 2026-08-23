import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ReaderWorker } from '../src/host/reader-worker.ts'
import { createMemoryDatabase } from './fixtures/create-memory-db.ts'

describe('read-only SQLite worker lifecycle', () => {
  it('terminates a timed-out worker and serves the next request from a replacement', async () => {
    const reader = new ReaderWorker({
      workerUrl: new URL('./fixtures/delayed-reader.worker.ts', import.meta.url),
    })

    await expect(
      reader.read(
        { databasePath: '/synthetic/vectors.db', ftsQuery: '"alpha"', sessionKeys: ['project-a'], limit: 1 },
        20,
      ),
    ).resolves.toEqual({ status: 'timeout' })
    await expect(
      reader.read(
        { databasePath: '/synthetic/vectors.db', ftsQuery: '"alpha"', sessionKeys: ['project-a'], limit: 1 },
        1_000,
      ),
    ).resolves.toEqual({ status: 'ok', rows: [] })

    await reader.close()
  })

  it('fails open after close instead of spawning an unowned worker', async () => {
    const reader = new ReaderWorker({
      workerUrl: new URL('./fixtures/delayed-reader.worker.ts', import.meta.url),
    })
    await reader.close()

    await expect(
      reader.read(
        { databasePath: '/synthetic/vectors.db', ftsQuery: '"alpha"', sessionKeys: ['project-a'], limit: 1 },
        250,
      ),
    ).resolves.toEqual({ status: 'unavailable' })
  })

  it('discovers only structural source counts and times through a fixed query', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-memory-discover-'))
    const root = join(base, 'memory')
    await mkdir(root)
    const path = join(root, 'vectors.db')
    createMemoryDatabase(path, [
      { recordId: 'one', sessionKey: 'project-a', content: 'synthetic one', source: 'l1', recordedAt: '2026-08-01T00:00:00Z' },
      { recordId: 'two', sessionKey: 'project-a', content: 'synthetic two', source: 'l0', recordedAt: '2026-08-02T00:00:00Z' },
      { recordId: 'three', sessionKey: 'project-b', content: 'synthetic three', source: 'l1' },
    ])
    const reader = new ReaderWorker({ workerUrl: new URL('../src/workers/sqlite-reader.worker.ts', import.meta.url) })

    await expect(reader.discover(path, 1_000)).resolves.toEqual({
      status: 'ok',
      sources: [
        { sessionKey: 'project-a', recordCount: 2, firstAt: '2026-08-01T00:00:00Z', lastAt: '2026-08-02T00:00:00Z' },
        { sessionKey: 'project-b', recordCount: 1, firstAt: null, lastAt: null },
      ],
    })
    await reader.close()
    await import('node:fs/promises').then((fs) => fs.rm(base, { recursive: true, force: true }))
  })
})
