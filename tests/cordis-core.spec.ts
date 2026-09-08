import { Context as HarnessContext } from '@deepseek-ai/cordis'
import * as UpstreamCordis from 'cordis'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import core, { getMemoryService, MemoryService } from '../src/core.ts'
import { loadOrCreateLocalKey } from '../src/host/local-key.ts'

// rc.9 has extensionless declaration reexports that NodeNext cannot resolve.
// Keep the runtime test real, using the common context operations exercised below.
const UpstreamContext = (UpstreamCordis as unknown as { Context: typeof HarnessContext }).Context

for (const [label, Context] of [['Harness Cordis', HarnessContext], ['upstream Cordis', UpstreamContext]] as const) {
  describe(label, () => {
    it('runs the full reviewed-memory lifecycle without any Harness service and retains data after reload', async () => {
      const root = await mkdtemp(join(tmpdir(), 'memory-cordis-'))
      const stateDirectory = join(root, 'isolated-home', 'memory')
      const projectA = join(root, 'a')
      const projectB = join(root, 'b')
      await Promise.all([mkdir(projectA), mkdir(projectB)])
      const ctx = new Context()
      try {
        const fiber = ctx.plugin(core, { stateDirectory })
        await fiber.await()
        const service = getMemoryService(ctx)
        expect(ctx.get('tools')).toBeUndefined()
        expect(ctx.get('missherBrain')).toBeUndefined()
        const a = service.project(projectA)
        const b = service.project(projectB)
        await expect(a.status()).resolves.toEqual({ status: 'unbound' })
        await expect(a.search({ query: 'architecture' })).resolves.toMatchObject({ status: 'project-unbound' })
        await expect(a.propose({ sourceId: 'fixture', drafts: [{ scope: 'project', kind: 'architecture', content: 'architecture alpha' }] })).resolves.toEqual({ status: 'unbound' })
        await expect(readdir(stateDirectory)).rejects.toMatchObject({ code: 'ENOENT' })

        await expect(service.bindProject({ cwd: projectA, sessionKeys: [] })).resolves.toMatchObject({ status: 'bound' })
        await expect(service.bindProject({ cwd: projectB, sessionKeys: [] })).resolves.toMatchObject({ status: 'bound' })
        const request = { sourceId: 'fixture-checkpoint', drafts: [{ scope: 'project' as const, kind: 'architecture' as const, content: 'architecture alpha uses a bounded queue' }] }
        const created = await a.propose(request)
        expect(created.status).toBe('created')
        if (created.status !== 'created') throw new Error('candidate missing')
        const id = created.candidateIds[0]!
        await expect(a.propose(request)).resolves.toEqual(created)
        await expect(a.search({ query: 'architecture' })).resolves.toMatchObject({ status: 'ready', results: [] })
        await expect(service.admin(projectB).approve(id)).resolves.toEqual({ status: 'unknown-candidate' })
        await expect(service.admin(projectB).forget(id)).resolves.toEqual({ status: 'unknown-candidate' })
        await expect(service.admin(projectA).approve(id)).resolves.toMatchObject({ status: 'approved' })
        const result = await a.search({ query: 'architecture' })
        expect(result).toMatchObject({ status: 'ready', results: [{ excerpt: request.drafts[0]!.content, reference: expect.any(String), recordedAt: expect.any(String) }] })
        if (result.status !== 'ready') throw new Error('search unavailable')
        const reference = result.results[0]!.reference
        await expect(a.get(reference)).resolves.toMatchObject({ status: 'ready', memory: { sourceReferences: [id], lifecycle: 'active' } })
        await expect(b.get(reference)).resolves.toEqual({ status: 'not-found' })
        await expect(b.search({ query: 'architecture' })).resolves.toMatchObject({ status: 'ready', results: [] })
        await expect(a.search({ query: 'architecture', scope: 'personal' })).resolves.toEqual({ status: 'scope-denied' })

        await fiber.dispose()
        expect(ctx.get('missherMemoryService')).toBeUndefined()
        await expect(a.search({ query: 'architecture' })).resolves.toEqual({ status: 'unavailable' })
        const reloaded = ctx.plugin(core, { stateDirectory })
        await reloaded.await()
        const restored = getMemoryService(ctx)
        await expect(restored.project(projectA).search({ query: 'architecture' })).resolves.toMatchObject({ status: 'ready', results: [{ reference: expect.any(String) }] })
        await expect(restored.admin(projectA).forget(id)).resolves.toEqual({ status: 'forgotten' })
        await expect(restored.project(projectA).search({ query: 'architecture' })).resolves.toMatchObject({ status: 'ready', results: [] })
      } finally {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      }
    })
  })
}

it('validates core options and bounds untrusted inputs without changing the caller project', async () => {
  expect(() => new MemoryService({ stateDirectory: 'relative' })).toThrow('absolute')
  const root = await mkdtemp(join(tmpdir(), 'memory-input-'))
  const stateDirectory = join(root, 'state')
  const service = new MemoryService({ stateDirectory, searchByteBudget: 12 })
  try {
    await service.bindProject({ cwd: root, sessionKeys: [] })
    const project = service.project(root)
    await expect(project.search({ query: 'queue', limit: NaN })).resolves.toMatchObject({ status: 'invalid-query' })
    await expect(project.propose({ sourceId: '', drafts: [] })).resolves.toEqual({ status: 'invalid-input' })
    await expect(project.propose({ sourceId: 'secret', drafts: [{ scope: 'project', kind: 'decision', content: '-----BEGIN PRIVATE KEY-----' }] })).resolves.toEqual({ status: 'rejected-sensitive' })
    await expect(project.propose({ sourceId: 'large', drafts: [{ scope: 'project', kind: 'decision', content: 'x'.repeat(2001) }] })).resolves.toEqual({ status: 'invalid-input' })
    const draft = { sourceId: 'immutable', drafts: [{ scope: 'project' as const, kind: 'architecture' as const, content: 'queue design keeps requests isolated' }] }
    const pending = project.propose(draft)
    draft.drafts[0]!.content = 'changed after enqueue'
    const created = await pending
    if (created.status !== 'created') throw new Error('candidate missing')
    await service.admin(root).approve(created.candidateIds[0]!)
    const result = await project.search({ query: 'queue' })
    expect(result).toMatchObject({ status: 'ready', usedBytes: 12, truncated: true })
  } finally {
    await service.close()
    await rm(root, { recursive: true, force: true })
  }
})

it('publishes one complete key under concurrent initialization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-key-race-'))
  try {
    const directory = join(root, 'state')
    const keys = await Promise.all(Array.from({ length: 24 }, () => loadOrCreateLocalKey(directory)))
    expect(keys.every(result => result.status === 'ready')).toBe(true)
    const encoded = keys.flatMap(result => result.status === 'ready' ? [result.key.toString('hex')] : [])
    expect(new Set(encoded).size).toBe(1)
    expect(await readdir(directory)).toEqual(['key.bin'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
