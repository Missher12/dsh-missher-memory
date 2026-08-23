import { mkdtemp, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from '../src/host/state-store.ts'

const roots: string[] = []

async function fixture(): Promise<{ root: string; cwd: string; stateDirectory: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-zero-state-'))
  roots.push(root)
  const cwd = join(root, 'project')
  await mkdir(cwd)
  return { root, cwd, stateDirectory: join(root, 'dsh-home', 'missher-memory') }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

describe('zero state creation boundary', () => {
  it('does not create state for construction, status, lookup, or list reads', async () => {
    const { root, cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })

    await expect(store.hasState()).resolves.toBe(false)
    await expect(store.lookupProject(cwd)).resolves.toEqual({ status: 'unbound' })
    await expect(store.listProjects()).resolves.toEqual([])
    await expect(readdir(root)).resolves.toEqual(['project'])
  })

  it('does not create state when a capture-off session is disposed', async () => {
    const { root, cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })

    await expect(store.canCapture(cwd)).resolves.toBe(false)
    await expect(store.recordDisposedSession(cwd, [])).resolves.toEqual({ status: 'disabled' })
    await expect(readdir(root)).resolves.toEqual(['project'])
  })
})
