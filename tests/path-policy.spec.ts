import { mkdtemp, mkdir, readdir, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveMemoryDatabase } from '../src/host/path-policy.ts'

const roots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-path-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

describe('memory database path policy', () => {
  it('rejects relative environment overrides without touching the filesystem', async () => {
    const base = await temporaryRoot()

    await expect(resolveMemoryDatabase({ overrideRoot: 'relative/root', homeDirectory: base })).resolves.toEqual({
      ok: false,
      code: 'unsafe-path',
      source: 'environment',
    })
    await expect(readdir(base)).resolves.toEqual([])
  })

  it('reports a missing default database without creating its directory', async () => {
    const home = await temporaryRoot()

    await expect(resolveMemoryDatabase({ homeDirectory: home })).resolves.toEqual({
      ok: false,
      code: 'not-configured',
      source: 'default',
    })
    await expect(readdir(home)).resolves.toEqual([])
  })

  it('rejects a symbolic-link root', async () => {
    const base = await temporaryRoot()
    const realRoot = join(base, 'real')
    const linkedRoot = join(base, 'linked')
    await mkdir(realRoot)
    await writeFile(join(realRoot, 'vectors.db'), 'not-a-database')
    await symlink(realRoot, linkedRoot, 'dir')

    await expect(resolveMemoryDatabase({ overrideRoot: linkedRoot, homeDirectory: base })).resolves.toEqual({
      ok: false,
      code: 'unsafe-path',
      source: 'environment',
    })
  })

  it('rejects a symbolic-link database', async () => {
    const base = await temporaryRoot()
    const root = join(base, 'memory')
    const outside = join(base, 'outside.db')
    await mkdir(root)
    await writeFile(outside, 'not-a-database')
    await symlink(outside, join(root, 'vectors.db'), 'file')

    await expect(resolveMemoryDatabase({ overrideRoot: root, homeDirectory: base })).resolves.toEqual({
      ok: false,
      code: 'unsafe-path',
      source: 'environment',
    })
  })

  it('accepts an existing regular database contained by a regular root', async () => {
    const base = await temporaryRoot()
    const root = join(base, 'memory')
    const databasePath = join(root, 'vectors.db')
    await mkdir(root)
    await writeFile(databasePath, 'fixture')

    const resolved = await resolveMemoryDatabase({ overrideRoot: root, homeDirectory: base })

    const canonicalRoot = await realpath(root)
    expect(resolved).toEqual({
      ok: true,
      rootPath: canonicalRoot,
      databasePath: join(canonicalRoot, 'vectors.db'),
      source: 'environment',
    })
  })
})
