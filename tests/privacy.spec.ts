import { describe, expect, it } from 'vitest'
import { inspectPrivacy, redactDiagnostic } from '../src/host/privacy.ts'

describe('memory privacy policy', () => {
  it.each([
    ['credential', 'api_key = sk-test-' + 'x'.repeat(32)],
    ['credential', 'password: synthetic-password-value'],
    ['credential', 'Cookie: session=synthetic-cookie-value'],
    ['private-key', '-----BEGIN PRIVATE KEY-----\nsynthetic'],
    ['connection-string', 'postgres://demo:synthetic@localhost/db'],
    ['identity-number', '11010519491231002X'],
    ['financial-number', '6222021234567890123'],
    ['sensitive-path', '/Users/example/.ssh/id_ed25519'],
    ['sensitive-path', 'C:\\Users\\example\\.env'],
  ] as const)('rejects %s without returning matched content', (category, text) => {
    expect(inspectPrivacy(text)).toEqual({ safe: false, category })
  })

  it('allows ordinary architecture and progress text', () => {
    expect(inspectPrivacy('决定把读取放进 Worker，下一步补齐超时测试。')).toEqual({ safe: true })
  })

  it('redacts secrets and absolute paths from diagnostics', () => {
    const diagnostic = redactDiagnostic(
      'failed at /Users/example/private/project with api_key=sk-test-' + 'z'.repeat(32),
    )

    expect(diagnostic).toBe('failed at [REDACTED_PATH] with [REDACTED_SECRET]')
    expect(diagnostic).not.toContain('/Users/')
    expect(diagnostic).not.toContain('sk-test-')
  })
})
