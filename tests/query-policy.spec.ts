import { describe, expect, it } from 'vitest'
import { normalizeFtsQuery } from '../src/host/query-policy.ts'

describe('FTS query policy', () => {
  it('rejects empty, oversized, NUL, and control-character input', () => {
    expect(normalizeFtsQuery('   ')).toEqual({ ok: false, code: 'empty' })
    expect(normalizeFtsQuery('字'.repeat(257))).toEqual({ ok: false, code: 'too-long' })
    expect(normalizeFtsQuery('safe\0unsafe')).toEqual({ ok: false, code: 'invalid' })
    expect(normalizeFtsQuery('safe\u0001unsafe')).toEqual({ ok: false, code: 'invalid' })
  })

  it('turns FTS and SQL syntax into quoted literal tokens joined by fixed AND', () => {
    expect(normalizeFtsQuery('alpha OR beta NOT gamma NEAR(delta)')).toEqual({
      ok: true,
      normalized: '"alpha" AND "OR" AND "beta" AND "NOT" AND "gamma" AND "NEAR" AND "delta"',
      tokenCount: 7,
    })
    expect(normalizeFtsQuery('name:"x" -- DROP TABLE l1_records;')).toEqual({
      ok: true,
      normalized: '"name" AND "x" AND "--" AND "DROP" AND "TABLE" AND "l1_records"',
      tokenCount: 6,
    })
  })

  it('normalizes Unicode and preserves emoji as searchable quoted tokens', () => {
    expect(normalizeFtsQuery('  Cafe\u0301  架构 🧠  ')).toEqual({
      ok: true,
      normalized: '"Café" AND "架构" AND "🧠"',
      tokenCount: 3,
    })
  })

  it('caps token count without allowing caller-controlled operators', () => {
    const query = Array.from({ length: 40 }, (_, index) => `t${index}`).join(' ')
    const result = normalizeFtsQuery(query)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tokenCount).toBe(32)
      expect(result.normalized).not.toContain('t32')
    }
  })
})
