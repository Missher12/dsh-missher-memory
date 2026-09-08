import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import plugin from '../src/index.ts'
import type { createMemorySearchTool } from '../src/host/memory-tool.ts'

it('keeps manual tools and core alive while Brain is absent, added, removed and restored', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-activation-'))
  const ctx = new Context()
  const registered: string[] = []
  let searchTool: ReturnType<typeof createMemorySearchTool> | undefined
  const previous = process.env.MISSHER_TENCENTDB_DIR
  process.env.MISSHER_TENCENTDB_DIR = join(root, 'absent-legacy')
  try {
    ctx.provide('dshHomePath', (...segments: string[]) => join(root, ...segments))
    ctx.provide('tools', { register: (tool: ReturnType<typeof createMemorySearchTool>) => {
      registered.push(tool.name)
      searchTool = tool
    } } as never)
    const fiber = ctx.plugin(plugin, { consolidationEnabled: false })
    await fiber.await()
    expect(registered).toEqual(['memory_search'])
    const core = ctx.missherMemoryService
    await core.bindProject({ cwd: root, sessionKeys: [] })
    const proposed = await core.project(root).propose({ sourceId: 'without-brain', drafts: [
      { scope: 'project', kind: 'architecture', content: 'architecture supports independent Cordis services' },
    ] })
    if (proposed.status !== 'created') throw new Error('candidate missing')
    await core.admin(root).approve(proposed.candidateIds[0]!)
    const execute = () => searchTool!.execute({ query: 'architecture' }, { agent: { session: { header: { cwd: root } } } } as never)
    await expect(execute()).resolves.toMatchObject({ status: 'ready', results: [{ reference: expect.any(String) }] })
    const register = vi.fn(() => vi.fn())
    const brain = ctx.provide('missherBrain', { register })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1))
    await brain()
    expect(register.mock.results[0]!.value).toHaveBeenCalledTimes(1)
    expect(ctx.missherMemoryService).toBe(core)
    await expect(execute()).resolves.toMatchObject({ status: 'ready', results: [{ reference: expect.any(String) }] })
    expect(registered).toEqual(['memory_search'])
    ctx.provide('missherBrain', { register })
    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(2))
    await fiber.dispose()
    expect(register.mock.results[1]!.value).toHaveBeenCalledTimes(1)
    expect(ctx.get('missherMemoryService')).toBeUndefined()
  } finally {
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env.MISSHER_TENCENTDB_DIR
    else process.env.MISSHER_TENCENTDB_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})
