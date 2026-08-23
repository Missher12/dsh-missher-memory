/** Search result after project filtering and privacy rejection. */
export interface SearchResultItem {
  excerpt: string
  kind: string
  source: string
  recordedAt: string | null
  reference: string
}

/** Result list with enforced UTF-8 and count budgets. */
export interface BudgetedSearchResults {
  results: SearchResultItem[]
  truncated: boolean
  usedBytes: number
}

const HARD_MAX_SEARCH_RESULTS = 10
const HARD_MAX_SEARCH_BYTES = 12_000

/**
 * Truncates text without splitting a Unicode code point.
 *
 * @param input Text to constrain.
 * @param maxBytes Maximum UTF-8 payload bytes.
 * @returns Text, truncation state, and exact UTF-8 byte count.
 */
export function truncateUtf8(input: string, maxBytes: number): { text: string; truncated: boolean; bytes: number } {
  const limit = Math.max(0, Math.floor(maxBytes))
  if (Buffer.byteLength(input, 'utf8') <= limit) {
    return { text: input, truncated: false, bytes: Buffer.byteLength(input, 'utf8') }
  }

  let text = ''
  let bytes = 0
  for (const codePoint of input) {
    const size = Buffer.byteLength(codePoint, 'utf8')
    if (bytes + size > limit) break
    text += codePoint
    bytes += size
  }
  return { text, truncated: true, bytes }
}

/**
 * Applies immutable hard limits and caller-selected lower limits to search rows.
 *
 * @param rows Privacy-filtered rows in relevance order.
 * @param options Requested count and UTF-8 byte limits.
 * @returns Rows with excerpts constrained to the effective limits.
 */
export function applySearchBudget(
  rows: readonly SearchResultItem[],
  options: { maxResults: number; maxBytes: number },
): BudgetedSearchResults {
  const maxResults = Math.max(1, Math.min(HARD_MAX_SEARCH_RESULTS, Math.floor(options.maxResults)))
  const maxBytes = Math.max(1, Math.min(HARD_MAX_SEARCH_BYTES, Math.floor(options.maxBytes)))
  const results: SearchResultItem[] = []
  let usedBytes = 0
  let truncated = rows.length > maxResults || options.maxResults > HARD_MAX_SEARCH_RESULTS || options.maxBytes > HARD_MAX_SEARCH_BYTES

  for (const row of rows.slice(0, maxResults)) {
    const excerpt = truncateUtf8(row.excerpt, maxBytes - usedBytes)
    if (excerpt.text.length === 0 && row.excerpt.length > 0) {
      truncated = true
      break
    }
    results.push({ ...row, excerpt: excerpt.text })
    usedBytes += excerpt.bytes
    truncated ||= excerpt.truncated
    if (usedBytes >= maxBytes) {
      truncated ||= results.length < rows.length
      break
    }
  }

  return { results, truncated, usedBytes }
}
