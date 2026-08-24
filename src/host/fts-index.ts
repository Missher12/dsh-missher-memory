const WORDS = /[\p{L}\p{N}\p{M}_]+(?:[-'][\p{L}\p{N}\p{M}_]+)*/gu
const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u

/** Deterministic words and CJK bigrams stored in the plugin-owned FTS index. */
export function memorySearchTerms(input: string): string {
  const terms = new Set<string>()
  for (const match of input.normalize('NFC').toLocaleLowerCase().matchAll(WORDS)) {
    const word = match[0]
    if (Array.from(word).length > 128) continue
    terms.add(word)
    if (!CJK.test(word)) continue
    const characters = Array.from(word)
    for (let index = 0; index < characters.length - 1; index += 1) {
      terms.add(characters.slice(index, index + 2).join(''))
    }
  }
  return [...terms].slice(0, 512).join(' ')
}

/** Fixed-operator FTS query derived only from literal normalized terms. */
export function memoryFtsQuery(input: string): string | undefined {
  const terms = memorySearchTerms(input).split(' ')
    .filter(term => term !== '' && !(CJK.test(term) && Array.from(term).length > 2))
    .slice(0, 32)
  if (terms.length === 0) return undefined
  return terms.map(term => `"${term.replace(/"/gu, '""')}"`).join(' AND ')
}
