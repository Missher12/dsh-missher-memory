import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectMemoryDatabase } from '../src/host/database-status.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-status-'))
  roots.push(root)
  return root
}

function createCompatibleDatabase(path: string): void {
  const database = new DatabaseSync(path)
  database.exec(`
    CREATE TABLE l1_records (
      record_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT,
      priority INTEGER,
      scene_name TEXT,
      session_key TEXT NOT NULL,
      session_id TEXT,
      timestamp TEXT,
      created_time TEXT,
      updated_time TEXT,
      metadata_json TEXT
    );
    CREATE VIRTUAL TABLE l1_fts USING fts5(record_id, content);
    CREATE TABLE l0_conversations (
      record_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      session_id TEXT,
      role TEXT,
      message_text TEXT NOT NULL,
      recorded_at TEXT,
      timestamp TEXT
    );
    CREATE VIRTUAL TABLE l0_fts USING fts5(record_id, message_text);
  `)
  database.close()
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

describe('external memory database status', () => {
  it('returns not configured and creates no directory or database', async () => {
    const home = await temporaryRoot()

    await expect(inspectMemoryDatabase({ homeDirectory: home })).resolves.toEqual({
      status: 'not-configured',
      source: 'default',
    })
    await expect(readdir(home)).resolves.toEqual([])
  })

  it('reports the compatible schema without exposing an absolute path', async () => {
    const base = await temporaryRoot()
    const root = join(base, 'memory')
    await mkdir(root)
    createCompatibleDatabase(join(root, 'vectors.db'))

    const status = await inspectMemoryDatabase({ overrideRoot: root, homeDirectory: base })

    expect(status).toEqual({
      status: 'ready',
      source: 'environment',
      schema: { l0: true, l1: true, fts5: true },
    })
    expect(JSON.stringify(status)).not.toContain(base)
  })

  it('distinguishes an incompatible schema from a corrupt database', async () => {
    const base = await temporaryRoot()
    const incompatibleRoot = join(base, 'incompatible')
    const corruptRoot = join(base, 'corrupt')
    await mkdir(incompatibleRoot)
    await mkdir(corruptRoot)
    const database = new DatabaseSync(join(incompatibleRoot, 'vectors.db'))
    database.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)')
    database.close()
    await writeFile(join(corruptRoot, 'vectors.db'), 'not sqlite bytes')

    await expect(inspectMemoryDatabase({ overrideRoot: incompatibleRoot, homeDirectory: base })).resolves.toEqual({
      status: 'incompatible',
      source: 'environment',
      schema: { l0: false, l1: false, fts5: false },
    })
    await expect(inspectMemoryDatabase({ overrideRoot: corruptRoot, homeDirectory: base })).resolves.toEqual({
      status: 'corrupt',
      source: 'environment',
    })
  })

  it('maps unsafe symlinks to an unsafe status without following them', async () => {
    const base = await temporaryRoot()
    const realRoot = join(base, 'real')
    const linkRoot = join(base, 'link')
    await mkdir(realRoot)
    createCompatibleDatabase(join(realRoot, 'vectors.db'))
    await import('node:fs/promises').then((fs) => fs.symlink(realRoot, linkRoot, 'dir'))

    await expect(inspectMemoryDatabase({ overrideRoot: linkRoot, homeDirectory: base })).resolves.toEqual({
      status: 'unsafe-path',
      source: 'environment',
    })
  })
})
