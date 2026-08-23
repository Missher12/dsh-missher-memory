/** Safe normalization result for caller-provided FTS text. */
export type NormalizedFtsQuery =
  | { ok: true; normalized: string; tokenCount: number }
  | { ok: false; code: 'empty' | 'too-long' | 'invalid' }

const MAX_QUERY_CHARACTERS = 256
const MAX_QUERY_TOKENS = 32
const TOKEN_PATTERN = /[\p{L}\p{N}\p{M}_]+(?:[-'][\p{L}\p{N}\p{M}_]+)*|--+|[\p{Extended_Pictographic}]/gu
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

/**
 * Converts untrusted search text into literal quoted FTS tokens.
 *
 * @param input Caller-provided search text.
 * @returns Fixed-operator FTS text or a safe validation error.
 */
export function normalizeFtsQuery(input: string): NormalizedFtsQuery {
  const normalizedInput = input.normalize('NFC').trim()
  if (normalizedInput.length === 0) return { ok: false, code: 'empty' }
  if (Array.from(normalizedInput).length > MAX_QUERY_CHARACTERS) return { ok: false, code: 'too-long' }
  if (DISALLOWED_CONTROL_PATTERN.test(normalizedInput)) return { ok: false, code: 'invalid' }

  const tokens = Array.from(normalizedInput.matchAll(TOKEN_PATTERN), (match) => match[0]).slice(0, MAX_QUERY_TOKENS)
  if (tokens.length === 0) return { ok: false, code: 'empty' }
  return {
    ok: true,
    normalized: tokens.map((token) => `"${token}"`).join(' AND '),
    tokenCount: tokens.length,
  }
}
