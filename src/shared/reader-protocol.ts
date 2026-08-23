/** Fixed fields accepted by the SQLite reader Worker. */
export interface ReaderSearchRequest {
  databasePath: string
  ftsQuery: string
  sessionKeys: readonly string[]
  limit: number
}

/** Fixed structural discovery request; no caller SQL or content selector exists. */
export interface ReaderDiscoverRequest {
  databasePath: string
}

/** Host-only source identity with structural metadata and no record content. */
export interface ReaderSource {
  sessionKey: string
  recordCount: number
  firstAt: string | null
  lastAt: string | null
}

/** Internal row returned by the SQLite reader before privacy filtering. */
export interface ReaderRow {
  recordId: string
  excerpt: string
  kind: string
  source: 'l0' | 'l1'
  recordedAt: string | null
  score: number
}

/** Safe Worker result states. */
export type ReaderResult =
  | { status: 'ok'; rows: ReaderRow[] }
  | { status: 'timeout' | 'corrupt' | 'incompatible' | 'unavailable' }

/** Structural discovery result kept inside the Host boundary. */
export type ReaderDiscoveryResult =
  | { status: 'ok'; sources: ReaderSource[] }
  | { status: 'timeout' | 'corrupt' | 'incompatible' | 'unavailable' }

/** Wire request with a Host-owned correlation identifier. */
export type ReaderWireRequest = (
  | ({ operation: 'search' } & ReaderSearchRequest)
  | ({ operation: 'discover' } & ReaderDiscoverRequest)
) & { id: number }

/** Wire response with no raw SQLite error text. */
export type ReaderWireResponse = (
  | ({ operation: 'search' } & ReaderResult)
  | ({ operation: 'discover' } & ReaderDiscoveryResult)
) & { id: number }
