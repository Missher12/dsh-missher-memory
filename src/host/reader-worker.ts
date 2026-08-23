import { Worker } from 'node:worker_threads'
import type {
  ReaderDiscoveryResult,
  ReaderDiscoverRequest,
  ReaderResult,
  ReaderSearchRequest,
  ReaderWireRequest,
  ReaderWireResponse,
} from '../shared/reader-protocol.ts'

type ReaderWirePayload =
  | ({ operation: 'search' } & ReaderSearchRequest)
  | ({ operation: 'discover' } & ReaderDiscoverRequest)

/** Construction options for the restartable SQLite reader. */
export interface ReaderWorkerOptions {
  workerUrl?: URL | undefined
}

/**
 * Serializes SQLite reads through a restartable Worker so deadlines are hard limits.
 */
export class ReaderWorker {
  readonly #workerUrl: URL
  #worker: Worker | undefined
  #closed = false
  #nextId = 1
  #queue: Promise<void> = Promise.resolve()

  /**
   * Creates a lazy Worker owner.
   *
   * @param options Optional Worker URL used by tests and built entrypoints.
   */
  constructor(options: ReaderWorkerOptions = {}) {
    this.#workerUrl = options.workerUrl ?? new URL('./workers/sqlite-reader.worker.js', import.meta.url)
  }

  /**
   * Runs one read after earlier reads and terminates the Worker at the deadline.
   *
   * @param request Fixed search request.
   * @param timeoutMs Hard deadline in milliseconds.
   * @returns Safe rows or one non-sensitive failure state.
   */
  read(request: ReaderSearchRequest, timeoutMs: number): Promise<ReaderResult> {
    if (this.#closed) return Promise.resolve({ status: 'unavailable' })
    const operation = this.#queue.then(async () => this.#requestNow<ReaderResult>({ operation: 'search', ...request }, timeoutMs))
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  /** Lists opaque Host-only source identities with counts and timestamps. */
  discover(databasePath: string, timeoutMs: number): Promise<ReaderDiscoveryResult> {
    if (this.#closed) return Promise.resolve({ status: 'unavailable' })
    const operation = this.#queue.then(async () =>
      this.#requestNow<ReaderDiscoveryResult>({ operation: 'discover', databasePath }, timeoutMs),
    )
    this.#queue = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  /** Terminates the owned Worker after the active read settles. */
  async close(): Promise<void> {
    this.#closed = true
    await this.#queue
    const worker = this.#worker
    this.#worker = undefined
    if (worker !== undefined) await worker.terminate()
  }

  async #requestNow<T extends ReaderResult | ReaderDiscoveryResult>(
    request: ReaderWirePayload,
    timeoutMs: number,
  ): Promise<T> {
    if (this.#closed) return { status: 'unavailable' } as T
    const worker = this.#worker ?? this.#spawn()
    const id = this.#nextId++
    const deadline = Math.max(1, Math.min(10_000, Math.floor(timeoutMs)))

    return new Promise<T>((resolve) => {
      let settled = false
      const finish = (result: T): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.off('exit', onExit)
        resolve(result)
      }
      const onMessage = (message: ReaderWireResponse): void => {
        if (message.id !== id) return
        const { id: _id, operation: _operation, ...result } = message
        finish(result as T)
      }
      const onError = (): void => {
        if (this.#worker === worker) this.#worker = undefined
        finish({ status: 'unavailable' } as T)
      }
      const onExit = (): void => {
        if (this.#worker === worker) this.#worker = undefined
        finish({ status: 'unavailable' } as T)
      }
      const timer = setTimeout(() => {
        if (this.#worker === worker) this.#worker = undefined
        void worker.terminate()
        finish({ status: 'timeout' } as T)
      }, deadline)

      worker.on('message', onMessage)
      worker.once('error', onError)
      worker.once('exit', onExit)
      worker.postMessage({ id, ...request } satisfies ReaderWireRequest)
    })
  }

  #spawn(): Worker {
    const worker = new Worker(this.#workerUrl)
    this.#worker = worker
    return worker
  }
}
