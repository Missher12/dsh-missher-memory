import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Loaded only by an isolated dsh profile; no model request or external database is used.
const phase = process.env.MEMORY_SMOKE_PHASE
export const inject = ['agents', 'agentLoop', 'tools', ...(phase === 'absent' ? [] : ['missherMemoryService', 'missherMemoryCore', 'missherMemory'])]
export async function apply(ctx) {
  const handles = []
  const root = process.env.MEMORY_SMOKE_ROOT
  try {
    assert.equal(ctx.get('missherBrain'), undefined)
    if (phase === 'absent') {
      assert.equal(ctx.tools.get('memory_search'), undefined)
      assert.equal(ctx.get('missherMemoryService'), undefined)
      assert.equal(ctx.get('missherMemory'), undefined)
      handles.push(await ctx.agents.create({ sessionId: 'memory-s2-absent-base', meta: { cwd: root } }))
    } else {
      const a = join(root, 'project-a')
      const b = join(root, 'project-b')
      await mkdir(a, { recursive: true })
      await mkdir(b, { recursive: true })
      const first = await ctx.agents.create({ sessionId: `memory-s2-${phase}-a`, meta: { cwd: a } })
      const second = await ctx.agents.create({ sessionId: `memory-s2-${phase}-b`, meta: { cwd: b } })
      handles.push(first, second)
      const memory = ctx.missherMemoryService
      const remote = ctx.missherMemory
      const coordinator = ctx.missherMemoryCore
      let calls = 0
      const search = async (agent) => {
        const result = await ctx.tools.execute({ name: 'memory_search', callId: `memory-s2-${++calls}`,
          agent, arguments: { query: 'architecture', scope: 'project' }, signal: new AbortController().signal })
        assert.equal(result.isError, false, JSON.stringify(result))
        assert.ok(result.content.some(block => block.type === 'text'))
        return result.value
      }
      if (phase === 'seed') {
        assert.equal((await search(first.agent)).status, 'project-unbound')
        for (const cwd of [a, b]) {
          await coordinator.noteCwd(cwd)
          const snapshot = await remote.snapshot()
          assert.ok(snapshot.projectCandidate)
          const bound = await remote.bindProject({ candidateId: snapshot.projectCandidate.candidateId, sourceIds: [] })
          assert.equal(bound.project.captureEnabled, false)
          assert.equal(bound.project.recallEnabled, false)
        }
        const pending = await memory.project(a).propose({ sourceId: 'synthetic-official-s2',
          drafts: [{ scope: 'project', kind: 'architecture', content: 'The architecture uses isolated project storage.' }] })
        assert.equal(pending.status, 'created')
        assert.equal((await search(first.agent)).results.length, 0)
        assert.equal((await memory.admin(b).approve(pending.candidateIds[0])).status, 'unknown-candidate')
        await remote.reviewCandidate({ action: 'approve', candidateId: pending.candidateIds[0] })
      }
      const recalled = await search(first.agent)
      assert.equal(recalled.status, 'ready')
      assert.equal(recalled.results.length, 1)
      const row = recalled.results[0]
      assert.ok(row.reference && row.source && row.recordedAt)
      const found = await memory.project(a).get(row.reference)
      assert.equal(found.status, 'ready')
      assert.equal(found.memory.sourceReferences.length, 1)
      const expectation = join(root, 'expected-memory.json')
      const identity = { reference: row.reference, content: found.memory.content, sources: found.memory.sourceReferences }
      if (phase === 'seed') await writeFile(expectation, JSON.stringify(identity))
      else assert.deepEqual(identity, JSON.parse(await readFile(expectation, 'utf8')))
      assert.equal((await memory.project(b).get(row.reference)).status, 'not-found')
      assert.equal((await search(second.agent)).results.length, 0)
      assert.equal((await search(first.agent)).results[0].reference, row.reference)
    }
    for (const handle of handles.reverse()) await handle.dispose()
    await writeFile(process.env.MEMORY_SMOKE_RESULT, JSON.stringify({ ok: true, phase,
      realOfficialProfile: true, realToolRegistry: true, realAgentObjects: true,
      realModelCall: false, realDesktopUI: false, automaticRecall: false }) + '\n')
    setImmediate(() => { void ctx.root.fiber.dispose() })
  } catch (error) {
    process.stderr.write(String(error.stack ?? error) + '\n')
    process.exitCode = 1
    setImmediate(() => { void ctx.root.fiber.dispose() })
  }
}
