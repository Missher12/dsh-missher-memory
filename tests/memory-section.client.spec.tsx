// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MemorySnapshot } from '../src/remote-contract.ts'
import { MemorySection } from '../src/client/MemorySection.tsx'
import { zh, type MemoryLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

function snapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    schemaVersion: 1,
    database: { status: 'ready', source: 'default', schema: { l0: true, l1: true, fts5: true } },
    projectCandidate: { candidateId: 'cand_0123456789abcdef', basename: 'super-project', shortHash: '1234abcd' },
    project: null,
    projects: [],
    sources: [{ sourceId: 'src_0123456789abcdef', shortHash: '87654321', recordCount: 12, firstAt: null, lastAt: '2026-08-20T00:00:00Z', bound: false }],
    candidates: [],
    approvedCount: 0,
    ...overrides,
  }
}

function props(view: MemorySnapshot) {
  return {
    load: vi.fn().mockResolvedValue(view),
    bindProject: vi.fn().mockResolvedValue(view),
    updateSettings: vi.fn().mockResolvedValue(view),
    reviewCandidate: vi.fn().mockResolvedValue(view),
    deleteProject: vi.fn().mockResolvedValue(view),
    exportProject: vi.fn().mockResolvedValue({ fileName: 'missher-memory-project.json', content: '{}' }),
    t: (key: MemoryLocaleKey) => key,
  }
}

describe('Harness memory settings section', () => {
  it('shows managed memory as ready when the optional legacy index is absent', async () => {
    const view = snapshot({
      database: { status: 'not-configured', source: 'default' },
      sources: [],
    })
    const input = {
      ...props(view),
      t: (key: MemoryLocaleKey) => zh[key],
    }

    render(<MemorySection {...input} />)

    expect(await screen.findByText('内置项目记忆')).not.toBeNull()
    expect(screen.getByText('已就绪')).not.toBeNull()
    expect(screen.getByText('可选旧记忆索引')).not.toBeNull()
    expect(screen.getByText('未连接（可选）')).not.toBeNull()
    expect(screen.queryByText('记忆索引')).toBeNull()
  })

  it('paints a stable placeholder before loading and requires explicit binding', async () => {
    let resolveSnapshot: ((value: MemorySnapshot) => void) | undefined
    const input = props(snapshot())
    input.load.mockReturnValue(new Promise<MemorySnapshot>((resolve) => { resolveSnapshot = resolve }))
    render(<MemorySection {...input} />)

    expect(document.querySelector('[data-memory-skeleton]')).not.toBeNull()
    resolveSnapshot?.(snapshot())
    await screen.findAllByText('super-project#1234abcd')
    expect(screen.getByText('databaseReady')).not.toBeNull()

    fireEvent.click(screen.getByLabelText('source 87654321'))
    fireEvent.click(screen.getByRole('button', { name: 'bindAction' }))
    await waitFor(() => {
      expect(input.bindProject).toHaveBeenCalledWith({
        candidateId: 'cand_0123456789abcdef',
        sourceIds: ['src_0123456789abcdef'],
      })
    })
  })

  it('keeps capture and recall separate and exposes candidate review actions', async () => {
    const project = {
      projectKey: 'prj_' + 'a'.repeat(32),
      basename: 'super-project',
      shortHash: '1234abcd',
      captureEnabled: false,
      recallEnabled: false,
      recallLimit: 3,
      recallByteBudget: 3000,
    }
    const view = snapshot({
      project,
      projects: [project],
      candidates: [{
        candidateId: 'memcand_' + '1'.repeat(24),
        projectShortHash: '1234abcd',
        scope: 'project',
        kind: 'next',
        content: 'Run packaged smoke.',
        status: 'pending',
        pinned: false,
        createdAt: '2026-08-22T00:00:00Z',
      }],
    })
    const input = props(view)
    render(<MemorySection {...input} />)

    await screen.findByDisplayValue('Run packaged smoke.')
    fireEvent.click(screen.getByRole('checkbox', { name: 'captureToggle' }))
    await waitFor(() => {
      expect(input.updateSettings).toHaveBeenCalledWith({ projectKey: project.projectKey, captureEnabled: true })
    })
    expect(input.updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ recallEnabled: true }))

    fireEvent.click(screen.getByRole('button', { name: 'approveAction' }))
    await waitFor(() => {
      expect(input.reviewCandidate).toHaveBeenCalledWith({
        action: 'approve',
        candidateId: 'memcand_' + '1'.repeat(24),
      })
    })
  })
})
