import { access, mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CandidateService } from '../src/host/candidate-service.ts'
import { CaptureBuffer } from '../src/host/capture-buffer.ts'
import { MemoryLifecycle } from '../src/host/lifecycle.ts'
import { StateStore } from '../src/host/state-store.ts'

const roots: string[] = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-memory-lifecycle-'))
  roots.push(root)
  const cwd = join(root, 'project')
  await mkdir(cwd)
  const stateDirectory = join(root, 'dsh-home', 'missher-memory')
  const store = new StateStore({ stateDirectory })
  const service = new CandidateService(store)
  const lifecycle = new MemoryLifecycle({
    store,
    candidates: service,
    buffer: new CaptureBuffer({ maxMessages: 16, maxMessageBytes: 1_000, maxSessionBytes: 8_000 }),
  })
  return { cwd, lifecycle, stateDirectory, store }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (root) => import('node:fs/promises').then((fs) => fs.rm(root, { recursive: true, force: true }))))
})

function session(cwd: string, id = 'session-a', extra: Record<string, unknown> = {}): Session {
  return { id, header: { cwd, ...extra } } as unknown as Session
}

function user(text: string): SessionEvent {
  return {
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
  } as unknown as SessionEvent
}

describe('capture lifecycle hard boundary', () => {
  it('creates no state for unbound session events or disposal', async () => {
    const { cwd, lifecycle, stateDirectory } = await fixture()
    const current = session(cwd)

    lifecycle.onEvent(current, user('完成搜索功能。'))
    lifecycle.onDisposed(current)
    await lifecycle.flush()

    await expect(access(stateDirectory)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates no candidate while a bound project still has capture disabled', async () => {
    const { cwd, lifecycle, store } = await fixture()
    const bound = await store.bindProject({ cwd, sessionKeys: [] })
    if (bound.status !== 'bound') throw new Error('binding failed')
    const current = session(cwd)

    lifecycle.onEvent(current, user('完成搜索功能。'))
    lifecycle.onDisposed(current)
    await lifecycle.flush()

    await expect(store.listCandidates(bound.project.projectKey)).resolves.toEqual([])
  })

  it('persists candidates only after binding and explicit capture enablement', async () => {
    const { cwd, lifecycle, store } = await fixture()
    const bound = await store.bindProject({ cwd, sessionKeys: [] })
    if (bound.status !== 'bound') throw new Error('binding failed')
    await store.updateSettings(bound.project.projectKey, { captureEnabled: true })
    const current = session(cwd)

    lifecycle.onEvent(current, user('下一步完成 packaged smoke。'))
    lifecycle.onDisposed(current)
    lifecycle.onDisposed(current)
    await lifecycle.flush()

    const candidates = await store.listCandidates(bound.project.projectKey)
    expect(candidates).toMatchObject([{ kind: 'next', status: 'pending' }])
    expect(candidates).toHaveLength(1)
  })

  it('ignores delegated sessions and fails open when lookups reject', async () => {
    const lookupProject = vi.fn().mockRejectedValue(new Error('synthetic failure'))
    const generate = vi.fn()
    const lifecycle = new MemoryLifecycle({
      store: { lookupProject } as never,
      candidates: { generate } as never,
      buffer: new CaptureBuffer({ maxMessages: 4, maxMessageBytes: 100, maxSessionBytes: 200 }),
    })
    const delegated = session('/synthetic/project', 'delegated', { origin: 'subagent', delegationDepth: 1 })

    expect(() => lifecycle.onEvent(delegated, user('ignored'))).not.toThrow()
    expect(() => lifecycle.onDisposed(delegated)).not.toThrow()
    await lifecycle.flush()
    expect(lookupProject).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()

    const top = session('/synthetic/project', 'top')
    lifecycle.onEvent(top, user('fails open'))
    lifecycle.onDisposed(top)
    await expect(lifecycle.flush()).resolves.toBeUndefined()
    expect(generate).not.toHaveBeenCalled()
  })

  it('drops a whole session if sensitive content appears before disposal', async () => {
    const { cwd, lifecycle, store } = await fixture()
    const bound = await store.bindProject({ cwd, sessionKeys: [] })
    if (bound.status !== 'bound') throw new Error('binding failed')
    await store.updateSettings(bound.project.projectKey, { captureEnabled: true })
    const current = session(cwd)

    lifecycle.onEvent(current, user('已完成架构设计。'))
    lifecycle.onEvent(current, user('password=synthetic-secret-value'))
    lifecycle.onDisposed(current)
    await lifecycle.flush()

    await expect(store.listCandidates(bound.project.projectKey)).resolves.toEqual([])
  })
})
