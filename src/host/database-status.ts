import { DatabaseSync } from 'node:sqlite'
import type { MemoryDatabaseStatus } from '../shared/types.ts'
import { resolveMemoryDatabase, type MemoryDatabasePathOptions } from './path-policy.ts'

interface SchemaRow {
  name: string
  sql: string | null
}

const REQUIRED_TABLES = ['l0_conversations', 'l0_fts', 'l1_records', 'l1_fts'] as const

/**
 * Inspects the external database with a read-only connection and fixed schema query.
 *
 * @param options Database root override and home directory inputs.
 * @returns A path-free public connection and schema status.
 */
export async function inspectMemoryDatabase(options: MemoryDatabasePathOptions = {}): Promise<MemoryDatabaseStatus> {
  const resolved = await resolveMemoryDatabase(options)
  if (!resolved.ok) return { status: resolved.code, source: resolved.source }

  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(resolved.databasePath, {
      readOnly: true,
      allowExtension: false,
      timeout: 500,
    })
    const rows = database
      .prepare(`SELECT name, sql FROM sqlite_schema WHERE name IN (${REQUIRED_TABLES.map(() => '?').join(', ')})`)
      .all(...REQUIRED_TABLES) as unknown as SchemaRow[]
    const schemas = new Map(rows.map((row) => [row.name, row.sql]))
    const l0 = schemas.has('l0_conversations') && schemas.has('l0_fts')
    const l1 = schemas.has('l1_records') && schemas.has('l1_fts')
    const fts5 = ['l0_fts', 'l1_fts'].every((name) => /\bUSING\s+fts5\b/iu.test(schemas.get(name) ?? ''))
    const schema = { l0, l1, fts5 }
    if (!l0 || !l1 || !fts5) return { status: 'incompatible', source: resolved.source, schema }
    return { status: 'ready', source: resolved.source, schema: { l0: true, l1: true, fts5: true } }
  } catch (error) {
    return { status: classifyDatabaseFailure(error), source: resolved.source }
  } finally {
    database?.close()
  }
}

function classifyDatabaseFailure(error: unknown): 'corrupt' | 'unavailable' {
  if (error instanceof Error && /not a database|malformed|database disk image/iu.test(error.message)) return 'corrupt'
  return 'unavailable'
}
