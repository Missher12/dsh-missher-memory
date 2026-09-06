import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import plugin from '../src/index.ts'

it('waits for the required Brain service before activating on a Cordis host', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-activation-'))
  const ctx = new Context()
  const registered: string[] = []
  const previous = process.env.MISSHER_TENCENTDB_DIR
  process.env.MISSHER_TENCENTDB_DIR = join(root, 'absent-legacy')
  try {
    ctx.provide('dshHomePath', (...segments: string[]) => join(root, ...segments))
    ctx.provide('tools', { register: (tool: { name: string }) => { registered.push(tool.name) } } as never)
    const fiber = ctx.plugin(plugin, { consolidationEnabled: false })
    await new Promise(resolve => setImmediate(resolve))
    expect(registered).toEqual([])
    ctx.provide('missherBrain', { register: () => () => {} })
    await fiber.await()
    expect(registered).toEqual(['memory_search'])
  } finally {
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env.MISSHER_TENCENTDB_DIR
    else process.env.MISSHER_TENCENTDB_DIR = previous
    await rm(root, { recursive: true, force: true })
  }
})
