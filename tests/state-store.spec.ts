import { DatabaseSync } from 'node:sqlite'
import { lstat, mkdtemp, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StateStore } from '../src/host/state-store.ts'

const roots: string[] = []

async function fixture(): Promise<{
  root: string
  cwd: string
  secondCwd: string
  sameNameCwd: string
  stateDirectory: string
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-state-'))
  roots.push(root)
  const cwd = join(root, 'project')
  const secondCwd = join(root, 'project-worktree')
  const sameNameCwd = join(root, 'nested', 'project')
  await mkdir(cwd)
  await mkdir(secondCwd)
  await mkdir(sameNameCwd, { recursive: true })
  return { root, cwd, secondCwd, sameNameCwd, stateDirectory: join(root, 'dsh-home', 'missher-memory') }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

describe('explicit project binding state', () => {
  it('creates private state only for explicit binding and stores no cwd or plain session key', async () => {
    const { cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })

    const result = await store.bindProject({ cwd, sessionKeys: ['session-alpha'] })

    expect(result).toEqual({
      status: 'bound',
      project: {
        projectKey: expect.stringMatching(/^prj_[a-f0-9]{32}$/u),
        basename: 'project',
        shortHash: expect.stringMatching(/^[a-f0-9]{8}$/u),
        captureEnabled: false,
        recallEnabled: false,
        recallLimit: 3,
        recallByteBudget: 3000,
        sessionKeys: ['session-alpha'],
      },
    })
    const stateEntry = await lstat(stateDirectory)
    const databaseEntry = await lstat(join(stateDirectory, 'state.db'))
    const keyEntry = await lstat(join(stateDirectory, 'key.bin'))
    expect(stateEntry.isDirectory()).toBe(true)
    expect(databaseEntry.isFile()).toBe(true)
    expect(keyEntry.isFile()).toBe(true)
    if (process.platform !== 'win32') {
      expect(stateEntry.mode & 0o777).toBe(0o700)
      expect(databaseEntry.mode & 0o777).toBe(0o600)
      expect(keyEntry.mode & 0o777).toBe(0o600)
    }
    const stateBytes = await readFile(join(stateDirectory, 'state.db'))
    expect(stateBytes.includes(Buffer.from(cwd))).toBe(false)
    expect(stateBytes.includes(Buffer.from('session-alpha'))).toBe(false)
  })

  it('links another worktree only after explicit confirmation', async () => {
    const { cwd, secondCwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })
    const bound = await store.bindProject({ cwd, sessionKeys: ['session-alpha'] })
    expect(bound.status).toBe('bound')
    if (bound.status !== 'bound') return

    await expect(store.lookupProject(secondCwd)).resolves.toEqual({ status: 'unbound' })
    await expect(store.linkProjectAlias(bound.project.projectKey, secondCwd)).resolves.toEqual({ status: 'linked' })
    const first = await store.lookupProject(cwd)
    const second = await store.lookupProject(secondCwd)

    expect(first.status).toBe('bound')
    expect(second.status).toBe('bound')
    if (first.status === 'bound' && second.status === 'bound') {
      expect(second.project.projectKey).toBe(first.project.projectKey)
    }
  })

  it('does not merge projects that merely share a basename', async () => {
    const { cwd, sameNameCwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })
    const first = await store.bindProject({ cwd, sessionKeys: ['session-alpha'] })
    const second = await store.bindProject({ cwd: sameNameCwd, sessionKeys: ['session-beta'] })

    expect(first.status).toBe('bound')
    expect(second.status).toBe('bound')
    if (first.status === 'bound' && second.status === 'bound') {
      expect(first.project.basename).toBe(second.project.basename)
      expect(first.project.projectKey).not.toBe(second.project.projectKey)
      expect(first.project.shortHash).not.toBe(second.project.shortHash)
    }
  })

  it('keeps settings off by default and applies explicit changes', async () => {
    const { cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })
    const bound = await store.bindProject({ cwd, sessionKeys: [] })
    expect(bound.status).toBe('bound')
    if (bound.status !== 'bound') return

    await expect(store.canCapture(cwd)).resolves.toBe(false)
    await expect(store.updateSettings(bound.project.projectKey, { captureEnabled: true })).resolves.toEqual({
      status: 'updated',
    })
    await expect(
      store.updateSettings(bound.project.projectKey, { recallEnabled: true, recallLimit: 5, recallByteBudget: 6000 }),
    ).resolves.toEqual({ status: 'updated' })
    await expect(store.canCapture(cwd)).resolves.toBe(true)
    const lookup = await store.lookupProject(cwd)
    expect(lookup).toMatchObject({
      status: 'bound',
      project: {
        captureEnabled: true,
        recallEnabled: true,
        recallLimit: 5,
        recallByteBudget: 6000,
      },
    })
  })

  it('uses deployment recall defaults without enabling recall', async () => {
    const { cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory, defaultRecallLimit: 4, defaultRecallByteBudget: 5000 })

    const bound = await store.bindProject({ cwd, sessionKeys: [] })

    expect(bound).toMatchObject({
      status: 'bound',
      project: { recallEnabled: false, recallLimit: 4, recallByteBudget: 5000 },
    })
  })

  it('detects a replaced local key and tampered ciphertext without leaking values', async () => {
    const { cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })
    await store.bindProject({ cwd, sessionKeys: ['session-alpha'] })
    const keyPath = join(stateDirectory, 'key.bin')
    const originalKeyPath = join(stateDirectory, 'key.original')
    await rename(keyPath, originalKeyPath)
    await writeFile(keyPath, Buffer.alloc(32, 4), { mode: 0o600 })

    await expect(store.lookupProject(cwd)).resolves.toEqual({ status: 'corrupt' })
    await rename(originalKeyPath, keyPath)
    const database = new DatabaseSync(join(stateDirectory, 'state.db'))
    database.exec("UPDATE bindings SET session_ciphertext = 'v1:invalid:invalid:invalid'")
    database.close()
    await expect(store.lookupProject(cwd)).resolves.toEqual({ status: 'corrupt' })
  })

  it('deletes only plugin-owned project rows in one explicit action', async () => {
    const { cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })
    const bound = await store.bindProject({ cwd, sessionKeys: ['session-alpha'] })
    expect(bound.status).toBe('bound')
    if (bound.status !== 'bound') return

    await expect(store.deleteProject(bound.project.projectKey)).resolves.toEqual({ status: 'deleted' })
    await expect(store.lookupProject(cwd)).resolves.toEqual({ status: 'unbound' })
    await expect(store.listProjects()).resolves.toEqual([])
    await expect(store.hasState()).resolves.toBe(true)
  })

  it('rejects a symbolic-link state directory', async () => {
    const { root, cwd } = await fixture()
    const realState = join(root, 'real-state')
    const linkedState = join(root, 'linked-state')
    await mkdir(realState)
    await symlink(realState, linkedState, 'dir')
    const store = new StateStore({ stateDirectory: linkedState })

    await expect(store.bindProject({ cwd, sessionKeys: [] })).resolves.toEqual({ status: 'unsafe-state' })
    await expect(import('node:fs/promises').then((fs) => fs.readdir(realState))).resolves.toEqual([])
  })

  it('refuses a future schema version without modifying it', async () => {
    const { cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })
    await store.bindProject({ cwd, sessionKeys: [] })
    const path = join(stateDirectory, 'state.db')
    const database = new DatabaseSync(path)
    database.exec('PRAGMA user_version = 99')
    database.close()

    await expect(store.lookupProject(cwd)).resolves.toEqual({ status: 'incompatible-state' })
    const unchanged = new DatabaseSync(path, { readOnly: true })
    expect((unchanged.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(99)
    unchanged.close()
  })

  it('never exposes an absolute cwd in project listings', async () => {
    const { cwd, stateDirectory } = await fixture()
    const store = new StateStore({ stateDirectory })
    await store.bindProject({ cwd, sessionKeys: [] })

    const projects = await store.listProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0]?.basename).toBe(basename(cwd))
    expect(JSON.stringify(projects)).not.toContain(cwd)
  })
})
