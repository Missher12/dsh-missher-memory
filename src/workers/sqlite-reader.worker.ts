import { DatabaseSync } from 'node:sqlite'
import { parentPort } from 'node:worker_threads'
import type { ReaderRow, ReaderSource, ReaderWireRequest, ReaderWireResponse } from '../shared/reader-protocol.ts'

const L1_SEARCH = `
  SELECT
    r.record_id AS recordId,
    r.content AS excerpt,
    COALESCE(r.type, 'memory') AS kind,
    COALESCE(r.timestamp, r.updated_time, r.created_time) AS recordedAt,
    bm25(l1_fts) AS score
  FROM l1_fts
  INNER JOIN l1_records AS r ON r.record_id = l1_fts.record_id
  WHERE l1_fts MATCH ?
    AND r.session_key IN (SELECT value FROM json_each(?))
  ORDER BY score
  LIMIT ?
`

const L0_SEARCH = `
  SELECT
    r.record_id AS recordId,
    r.message_text AS excerpt,
    'conversation' AS kind,
    COALESCE(r.recorded_at, r.timestamp) AS recordedAt,
    bm25(l0_fts) AS score
  FROM l0_fts
  INNER JOIN l0_conversations AS r ON r.record_id = l0_fts.record_id
  WHERE l0_fts MATCH ?
    AND r.session_key IN (SELECT value FROM json_each(?))
  ORDER BY score
  LIMIT ?
`

const DISCOVER_SOURCES = `
  WITH all_records AS (
    SELECT session_key AS sessionKey, COALESCE(timestamp, updated_time, created_time) AS recordedAt
    FROM l1_records
    WHERE session_key IS NOT NULL AND session_key <> ''
    UNION ALL
    SELECT session_key AS sessionKey, COALESCE(recorded_at, timestamp) AS recordedAt
    FROM l0_conversations
    WHERE session_key IS NOT NULL AND session_key <> ''
  )
  SELECT sessionKey, count(*) AS recordCount, min(recordedAt) AS firstAt, max(recordedAt) AS lastAt
  FROM all_records
  GROUP BY sessionKey
  ORDER BY COALESCE(lastAt, '') DESC, sessionKey
  LIMIT 200
`

if (parentPort === null) throw new Error('SQLite reader requires a Worker parent')

parentPort.on('message', (request: ReaderWireRequest) => {
  parentPort?.postMessage(request.operation === 'discover' ? runDiscovery(request) : runSearch(request))
})

function runSearch(request: Extract<ReaderWireRequest, { operation: 'search' }>): ReaderWireResponse {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(request.databasePath, {
      readOnly: true,
      allowExtension: false,
      timeout: 250,
    })
    const sessionKeys = JSON.stringify(request.sessionKeys)
    const limit = Math.max(1, Math.min(20, Math.floor(request.limit)))
    const l1 = database.prepare(L1_SEARCH).all(request.ftsQuery, sessionKeys, limit) as unknown as Array<
      Omit<ReaderRow, 'source'>
    >
    const l0 = database.prepare(L0_SEARCH).all(request.ftsQuery, sessionKeys, limit) as unknown as Array<
      Omit<ReaderRow, 'source'>
    >
    const rows = [
      ...l1.map((row) => ({ ...row, source: 'l1' as const })),
      ...l0.map((row) => ({ ...row, source: 'l0' as const })),
    ]
      .sort((left, right) => left.score - right.score)
      .slice(0, limit)
    return { id: request.id, operation: 'search', status: 'ok', rows }
  } catch (error) {
    return { id: request.id, operation: 'search', status: classifyFailure(error) }
  } finally {
    database?.close()
  }
}

function runDiscovery(request: Extract<ReaderWireRequest, { operation: 'discover' }>): ReaderWireResponse {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(request.databasePath, {
      readOnly: true,
      allowExtension: false,
      timeout: 250,
    })
    const sources = database.prepare(DISCOVER_SOURCES).all() as unknown as ReaderSource[]
    return { id: request.id, operation: 'discover', status: 'ok', sources }
  } catch (error) {
    return { id: request.id, operation: 'discover', status: classifyFailure(error) }
  } finally {
    database?.close()
  }
}

function classifyFailure(error: unknown): 'corrupt' | 'incompatible' | 'unavailable' {
  if (!(error instanceof Error)) return 'unavailable'
  if (/not a database|malformed|database disk image/iu.test(error.message)) return 'corrupt'
  if (/no such table|no such column|no such module|unable to use function bm25/iu.test(error.message)) return 'incompatible'
  return 'unavailable'
}
