/** Source used to locate the external memory database. */
export type DatabasePathSource = 'default' | 'environment'

/** Safe public status for the external memory database. */
export type MemoryDatabaseStatus =
  | { status: 'not-configured'; source: DatabasePathSource }
  | { status: 'unsafe-path'; source: DatabasePathSource }
  | { status: 'unavailable'; source: DatabasePathSource }
  | {
      status: 'incompatible'
      source: DatabasePathSource
      schema: { l0: boolean; l1: boolean; fts5: boolean }
    }
  | {
      status: 'ready'
      source: DatabasePathSource
      schema: { l0: true; l1: true; fts5: true }
    }
  | { status: 'corrupt'; source: DatabasePathSource }
