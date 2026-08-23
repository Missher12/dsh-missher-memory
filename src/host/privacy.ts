/** Non-sensitive reason for rejecting memory content. */
export type PrivacyCategory =
  | 'credential'
  | 'private-key'
  | 'connection-string'
  | 'identity-number'
  | 'financial-number'
  | 'sensitive-path'

const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/u
const CONNECTION_STRING_PATTERN = /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]+/iu
const NAMED_CREDENTIAL_PATTERN = /\b(?:api[_-]?key|secret|token|password|passwd|cookie|authorization)\b\s*[:=]\s*\S+/iu
const TOKEN_PATTERN = /\b(?:sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9_-]{20,}\b/u
const IDENTITY_PATTERN = /(?<!\d)\d{17}[\dXx](?!\d)/u
const FINANCIAL_PATTERN = /(?<!\d)\d{16,19}(?!\d)/u
const SENSITIVE_PATH_PATTERN = /(?:\/(?:Users|home)\/[^\s]+|[A-Za-z]:\\Users\\[^\s]+)(?:[\\/](?:\.ssh|\.env|\.aws|\.config|Library[\\/]Keychains)[^\s]*)?/iu
const DIAGNOSTIC_PATH_PATTERN = /(?:\/(?:Users|home)\/[^\s]+|[A-Za-z]:\\Users\\[^\s]+)/gu

/**
 * Classifies whether text is safe to store or inject without returning matched data.
 *
 * @param text Candidate or retrieved memory text.
 * @returns Safe state or one non-sensitive rejection category.
 */
export function inspectPrivacy(text: string): { safe: true } | { safe: false; category: PrivacyCategory } {
  if (PRIVATE_KEY_PATTERN.test(text)) return { safe: false, category: 'private-key' }
  if (CONNECTION_STRING_PATTERN.test(text)) return { safe: false, category: 'connection-string' }
  if (NAMED_CREDENTIAL_PATTERN.test(text) || TOKEN_PATTERN.test(text)) return { safe: false, category: 'credential' }
  if (IDENTITY_PATTERN.test(text)) return { safe: false, category: 'identity-number' }
  if (FINANCIAL_PATTERN.test(text)) return { safe: false, category: 'financial-number' }
  if (SENSITIVE_PATH_PATTERN.test(text)) return { safe: false, category: 'sensitive-path' }
  return { safe: true }
}

/**
 * Removes absolute user paths and credential values from diagnostic text.
 *
 * @param diagnostic Internal error or status text.
 * @returns Single-line text safe for logs and RPC errors.
 */
export function redactDiagnostic(diagnostic: string): string {
  return diagnostic
    .replace(DIAGNOSTIC_PATH_PATTERN, '[REDACTED_PATH]')
    .replace(NAMED_CREDENTIAL_PATTERN, '[REDACTED_SECRET]')
    .replace(TOKEN_PATTERN, '[REDACTED_SECRET]')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 240)
}
