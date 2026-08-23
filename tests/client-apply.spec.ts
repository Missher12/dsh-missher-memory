// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { MemorySection, type MemorySectionProps } from '../src/client/MemorySection.tsx'
import type { MemorySnapshot } from '../src/remote-contract.ts'

const EMPTY: MemorySnapshot = {
  schemaVersion: 1,
  database: { status: 'not-configured', source: 'default' },
  projectCandidate: null,
  project: null,
  projects: [],
  sources: [],
  candidates: [],
  approvedCount: 0,
}

describe('memory Client plugin registration', () => {
  it('mounts Remote first and contributes one lazy localized Harness settings section', async () => {
    const order: string[] = []
    let registration: { id?: string; order?: number; inject?: () => MemorySectionProps } | undefined
    let component: unknown
    const unmount = vi.fn(async () => undefined)
    const service = {
      snapshot: vi.fn(async () => ({ ok: true as const, value: EMPTY })),
      bindProject: vi.fn(), updateSettings: vi.fn(), deleteProject: vi.fn(), reviewCandidate: vi.fn(), exportProject: vi.fn(),
    }
    const ctx = {
      remote: { $mount: vi.fn(async () => { order.push('remote'); return unmount }) },
      get: vi.fn(() => service),
      effect: vi.fn((setup: () => unknown) => setup()),
      locale: {
        register: vi.fn(() => () => undefined),
        bind: vi.fn(() => ((key: string) => key)),
      },
      slots: {
        inject: vi.fn((_name: string, setup: () => unknown) => setup()),
        register: vi.fn((options: typeof registration, value: unknown) => {
          order.push('section')
          registration = options
          component = value
          return () => undefined
        }),
      },
    }

    const dispose = await apply(ctx as never)

    expect(inject).toEqual(['slots', 'locale', 'remote'])
    expect(order).toEqual(['remote', 'section'])
    expect(registration).toMatchObject({ id: 'missher-memory', order: 14 })
    expect(component).toBe(MemorySection)
    await expect(registration?.inject?.().load()).resolves.toEqual(EMPTY)
    await dispose()
    expect(unmount).toHaveBeenCalledOnce()
  })
})
