import type { ReaderSource } from '../shared/reader-protocol.ts'
import type { MemoryDatabasePathOptions } from './path-policy.ts'
import { resolveMemoryDatabase } from './path-policy.ts'
import type { ReaderWorker } from './reader-worker.ts'

export type SourceDiscoveryResult =
  | { status: 'ready'; sources: ReaderSource[] }
  | { status: 'not-configured' | 'unsafe-path' | 'timeout' | 'corrupt' | 'incompatible' | 'unavailable' }

/** Fixed-query source discovery that never returns record content outside the Worker. */
export class SourceDiscoveryService {
  constructor(
    private readonly reader: Pick<ReaderWorker, 'discover'>,
    private readonly database: MemoryDatabasePathOptions,
    private readonly timeoutMs: number,
  ) {}

  async discover(): Promise<SourceDiscoveryResult> {
    const database = await resolveMemoryDatabase(this.database)
    if (!database.ok) return { status: database.code }
    const result = await this.reader.discover(database.databasePath, this.timeoutMs)
    return result.status === 'ok' ? { status: 'ready', sources: result.sources } : result
  }
}
