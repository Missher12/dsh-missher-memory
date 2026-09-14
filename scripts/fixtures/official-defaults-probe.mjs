import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as deepseek from '@deepseek-ai/dsh-llm-deepseek'

export const inject = ['agents', 'agentLoop', 'tools', 'llm', 'missherMemoryService', 'missherMemoryCore', 'missherMemory']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, accept, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await read(); if (accept(value)) return value; await sleep(25) }
  throw new Error('default-memory expectation timed out')
}
export async function apply(ctx) {
  const phase = process.env.MEMORY_SMOKE_PHASE
  const root = process.env.MEMORY_SMOKE_ROOT
  const a = join(root, 'project-a')
  const b = join(root, 'project-b')
  const handles = []
  const requests = []
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/chat/completions')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      requests.push(JSON.parse(Buffer.concat(chunks)))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: `loopback-${requests.length}`,
        object: 'chat.completion.chunk', created: 1, model: 'deepseek-v4-flash',
        choices: [{ index: 0, delta, finish_reason }] })}\n\n`
      res.write(chunk({ role: 'assistant', content: 'Architecture bluewidget assistant evidence.' }))
      res.write(chunk({}, 'stop'))
      res.end('data: [DONE]\n\n')
    } catch (error) { res.writeHead(500); res.end(String(error)) }
  })
  let activeBrain
  ctx.inject(['missherBrain'], brainCtx => {
    activeBrain = brainCtx.missherBrain
    brainCtx.effect(() => () => { activeBrain = undefined })
  })
  let providerFiber
  let brainFiber
  try {
    await Promise.all([mkdir(a, { recursive: true }), mkdir(b, { recursive: true })])
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    providerFiber = ctx.plugin(deepseek, { baseURL: `http://127.0.0.1:${server.address().port}`,
      apiKeyEnv: 'MEMORY_LOOPBACK_KEY', thinking: 'disabled', maxTokens: 128 })
    await providerFiber.await()
    const memory = ctx.missherMemoryService
    const coordinator = ctx.missherMemoryCore
    const remote = ctx.missherMemory
    const agent = async (id, cwd) => {
      const h = await ctx.agents.create({ sessionId: `${phase}-${id}`, meta: { cwd },
        agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
      handles.push(h)
      await h.agent.whenIdle()
      return h
    }
    const turn = async (h, text) => {
      const before = requests.length
      h.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await h.agent.whenIdle()
      assert.equal(requests.length, before + 1, JSON.stringify(h.agent.session.snapshotEvents().slice(-3)))
      assert.ok(h.agent.session.snapshotEvents().some(e => e.type === 'assistant/message'))
      return requests.at(-1)
    }
    const recallEvents = h => h.agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.kind === 'plugin' && e.data.source.plugin === 'missher-brain')
    const dispose = async h => { await h.dispose(); handles.splice(handles.indexOf(h), 1) }
    assert.equal(ctx.get('missherBrain'), undefined)
    if (phase === 'seed') {
      const unbound = await agent('unbound', a)
      await turn(unbound, 'architecture before binding')
      await dispose(unbound)
      assert.equal((await memory.status()).hasState, false)
      for (const cwd of [a, b]) {
        await coordinator.noteCwd(cwd)
        const snapshot = await remote.snapshot()
        const bound = await remote.bindProject({ candidateId: snapshot.projectCandidate.candidateId, sourceIds: [] })
        assert.equal(bound.project.captureEnabled, true)
        assert.equal(bound.project.recallEnabled, true)
      }
      const capture = await agent('capture', a)
      await turn(capture, 'Architecture bluewidget capture decision.')
      assert.equal(recallEvents(capture).length, 0)
      await dispose(capture)
      const inbox = await until(() => memory.admin(a).candidates(), x => x.status === 'ready' && x.candidates.length === 2)
      assert.ok(inbox.candidates.every(c => c.status === 'pending'))
      assert.equal((await memory.project(a).search({ query: 'bluewidget' })).results.length, 0)
      for (const candidate of inbox.candidates) await remote.reviewCandidate({ action: 'approve', candidateId: candidate.candidateId })
      const visible = await memory.project(a).search({ query: 'bluewidget' })
      assert.equal(visible.results.length, 2)
      await writeFile(join(root, 'default-reference.json'), JSON.stringify(visible.results.map(r => r.reference).sort()))
      // Age only these synthetic duplicate rows; the real 30-second startup timer is unchanged.
      for (let i = 0; i < 4; i++) {
        const draft = await memory.project(a).propose({ sourceId: `maintenance-${i}`, drafts: [
          { scope: 'project', kind: 'architecture', content: 'Architecture amberunit maintenance fixture.' },
        ] })
        assert.equal(draft.status, 'created')
        await memory.admin(a).approve(draft.candidateIds[0])
      }
      const database = new DatabaseSync(join(process.env.DSH_HOME, 'missher-memory', 'state.db'))
      try { database.prepare('UPDATE approved_memories SET created_at = ?, updated_at = ? WHERE content = ?')
        .run('2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', 'Architecture amberunit maintenance fixture.') }
      finally { database.close() }
    } else {
      const found = await memory.project(a).search({ query: 'bluewidget' })
      assert.deepEqual(found.results.map(r => r.reference).sort(), JSON.parse(await readFile(join(root, 'default-reference.json'), 'utf8')))
    }
    const brain = await import(process.env.MEMORY_SMOKE_BRAIN_URL)
    brainFiber = ctx.plugin(brain.default)
    await brainFiber.await()
    await until(async () => activeBrain?.listProviders() ?? [], providers => providers.length === 1)
    assert.equal(activeBrain.listProviders()[0].id, 'memory')
    const recalled = await agent('recall', a)
    const request = await turn(recalled, 'bluewidget')
    const events = recallEvents(recalled)
    assert.equal(events.length, 1)
    const text = events[0].data.content.map(x => x.text ?? '').join('')
    assert.ok(text.includes('bluewidget'))
    const reference = JSON.parse(await readFile(join(root, 'default-reference.json'), 'utf8'))[0]
    assert.ok(text.includes(reference))
    assert.ok(JSON.stringify(request.messages).includes(reference))
    assert.ok(Buffer.byteLength(text) <= 4000)
    await turn(recalled, 'bluewidget')
    assert.equal(recallEvents(recalled).length, 2)
    await dispose(recalled)
    const isolated = await agent('other-project', b)
    const otherRequest = await turn(isolated, 'bluewidget')
    assert.equal(recallEvents(isolated).length, 0)
    assert.ok(!JSON.stringify(otherRequest.messages).includes(reference))
    await dispose(isolated)
    await brainFiber.dispose()
    assert.equal(ctx.get('missherBrain'), undefined)
    assert.ok(ctx.tools.get('memory_search'))
    const without = await agent('brain-removed', a)
    await turn(without, 'bluewidget')
    assert.equal(recallEvents(without).length, 0)
    await dispose(without)
    brainFiber = ctx.plugin(brain.default)
    await brainFiber.await()
    await until(async () => activeBrain?.listProviders() ?? [], providers => providers.length === 1)
    const restored = await agent('brain-restored', a)
    await turn(restored, 'bluewidget')
    assert.equal(recallEvents(restored).length, 1)
    await dispose(restored)
    if (phase === 'seed') {
      await until(() => memory.project(a).search({ query: 'amberunit' }), x => x.results.length === 1 && x.results[0].source.includes('capsule'), 45000)
      const db = new DatabaseSync(join(process.env.DSH_HOME, 'missher-memory', 'state.db'), { readOnly: true })
      try { assert.ok(db.prepare("SELECT count(*) AS n FROM maintenance_runs WHERE trigger = 'automatic' AND result = 'consolidated'").get().n >= 1) }
      finally { db.close() }
    }
    const inbox = await memory.admin(a).candidates()
    assert.ok(inbox.candidates.every(c => !c.content.includes(reference)))
    await writeFile(process.env.MEMORY_SMOKE_RESULT, JSON.stringify({ ok: true, phase, loopbackRequests: requests.length,
      defaultCapture: true, reviewBeforeRecall: true, optionalBrainLifecycle: true, recallLoggedAndSent: true,
      noDuplicateRecall: true, crossProjectIsolation: true, pluginRecallExcludedFromCapture: true,
      maintenanceTimerVerified: phase === 'seed', defaultFlags: { capture: true, recall: true, maintenance: true }, realOfficialProfile: true, realModelProtocolLoopback: true,
      realAccountRequests: false, realDesktopUI: false }) + '\n')
  } catch (error) { process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1 }
  finally {
    for (const h of handles.reverse()) await h.dispose()
    await brainFiber?.dispose()
    await providerFiber?.dispose()
    await new Promise(resolve => server.close(resolve))
    setImmediate(() => { void ctx.root.fiber.dispose() })
  }
}
