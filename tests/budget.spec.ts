import { describe, expect, it } from 'vitest'
import { applySearchBudget, truncateUtf8 } from '../src/host/budget.ts'

describe('UTF-8 result budgets', () => {
  it('truncates at code-point boundaries', () => {
    expect(truncateUtf8('A🧠B', 5)).toEqual({ text: 'A🧠', truncated: true, bytes: 5 })
    expect(truncateUtf8('A🧠B', 4)).toEqual({ text: 'A', truncated: true, bytes: 1 })
    expect(truncateUtf8('完整', 6)).toEqual({ text: '完整', truncated: false, bytes: 6 })
  })

  it('keeps source metadata while enforcing result and byte limits', () => {
    const result = applySearchBudget(
      [
        { excerpt: '架构决定', kind: 'decision', source: 'l1', recordedAt: '2026-08-01', reference: 'one' },
        { excerpt: '下一步计划', kind: 'next', source: 'l1', recordedAt: '2026-08-02', reference: 'two' },
        { excerpt: 'ignored', kind: 'progress', source: 'l0', recordedAt: '2026-08-03', reference: 'three' },
      ],
      { maxResults: 2, maxBytes: 21 },
    )

    expect(result).toEqual({
      results: [
        { excerpt: '架构决定', kind: 'decision', source: 'l1', recordedAt: '2026-08-01', reference: 'one' },
        { excerpt: '下一步', kind: 'next', source: 'l1', recordedAt: '2026-08-02', reference: 'two' },
      ],
      truncated: true,
      usedBytes: 21,
    })
  })

  it('enforces immutable hard limits above caller configuration', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      excerpt: `row-${index}`,
      kind: 'progress',
      source: 'l0',
      recordedAt: null,
      reference: `r-${index}`,
    }))
    const result = applySearchBudget(rows, { maxResults: 999, maxBytes: 999_999 })

    expect(result.results).toHaveLength(10)
    expect(result.usedBytes).toBeLessThanOrEqual(12_000)
    expect(result.truncated).toBe(true)
  })
})
