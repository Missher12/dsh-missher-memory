import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ReaderWorker } from '../src/host/reader-worker.ts'
import { MemorySearchService } from '../src/host/search-service.ts'
import { createMemoryDatabase } from './fixtures/create-memory-db.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

describe('bundled TencentDB compatibility reader', () => {
  it('keeps the exact legacy database bytes unchanged across repeated searches', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-memory-tencent-isolation-'))
    roots.push(base)
    const root = join(base, 'memory')
    await mkdir(root)
    const path = join(root, 'vectors.db')
    createMemoryDatabase(path, [{
      recordId: 'legacy-a',
      sessionKey: 'project-a',
      content: 'legacy architecture boundary',
      source: 'l1',
    }])
    const before = await sha256(path)
    const reader = new ReaderWorker({ workerUrl: new URL('../src/workers/sqlite-reader.worker.ts', import.meta.url) })
    const search = new MemorySearchService(reader)

    for (let index = 0; index < 5; index += 1) {
      await expect(search.search({
        database: { overrideRoot: root, homeDirectory: base },
        sessionKeys: ['project-a'],
        query: 'architecture',
        limit: 5,
        maxBytes: 2_000,
        timeoutMs: 1_000,
      })).resolves.toMatchObject({ status: 'ready' })
    }
    await reader.close()

    expect(await sha256(path)).toBe(before)
  })
})
