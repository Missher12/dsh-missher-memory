import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { CandidateService } from './candidate-service.ts'
import type { CaptureBuffer } from './capture-buffer.ts'
import type { StateStore } from './state-store.ts'

interface LifecycleOptions {
  store: Pick<StateStore, 'lookupProject'>
  candidates: Pick<CandidateService, 'generate'>
  buffer: CaptureBuffer
}

/** Serial, fail-open session capture that never writes before binding and enablement. */
export class MemoryLifecycle {
  readonly #store: LifecycleOptions['store']
  readonly #candidates: LifecycleOptions['candidates']
  readonly #buffer: CaptureBuffer
  readonly #tails = new Map<string, Promise<void>>()
  readonly #disposed = new Set<string>()

  constructor(options: LifecycleOptions) {
    this.#store = options.store
    this.#candidates = options.candidates
    this.#buffer = options.buffer
  }

  /** Queues one committed event only for a top-level, bound, capture-enabled project. */
  onEvent(session: Session, event: SessionEvent): void {
    if (!eligibleSession(session) || this.#disposed.has(session.id)) return
    const cwd = session.header.cwd
    if (cwd === undefined) return
    this.#enqueue(session.id, async () => {
      try {
        const lookup = await this.#store.lookupProject(cwd)
        if (lookup.status !== 'bound' || !lookup.project.captureEnabled) return
        this.#buffer.add(session.id, event)
      } catch {
        // Capture is optional and cannot interrupt the Harness event stream.
      }
    })
  }

  /** Drains exactly once and creates review candidates only if capture remains enabled. */
  onDisposed(session: Session): void {
    if (!eligibleSession(session) || this.#disposed.has(session.id)) return
    this.#disposed.add(session.id)
    const cwd = session.header.cwd
    if (cwd === undefined) return
    this.#enqueue(session.id, async () => {
      try {
        const lookup = await this.#store.lookupProject(cwd)
        const messages = this.#buffer.drain(session.id)
        if (lookup.status !== 'bound' || !lookup.project.captureEnabled || messages.length === 0) return
        await this.#candidates.generate(lookup.project.projectKey, session.id, messages)
      } catch {
        this.#buffer.drain(session.id)
        // Candidate persistence is optional and cannot block session disposal.
      }
    })
  }

  /** Waits for queued optional work, then drops all process-memory text. */
  async close(): Promise<void> {
    await this.flush()
    this.#buffer.clear()
    this.#disposed.clear()
  }

  /** Testable drain used by plugin teardown. */
  async flush(): Promise<void> {
    while (this.#tails.size > 0) await Promise.all([...this.#tails.values()])
  }

  #enqueue(sessionId: string, task: () => Promise<void>): void {
    const previous = this.#tails.get(sessionId) ?? Promise.resolve()
    let tail: Promise<void>
    tail = previous
      .catch(() => undefined)
      .then(task)
      .catch(() => undefined)
      .finally(() => {
        if (this.#tails.get(sessionId) === tail) this.#tails.delete(sessionId)
      })
    this.#tails.set(sessionId, tail)
  }
}

function eligibleSession(session: Session): boolean {
  return (
    session.header.cwd !== undefined &&
    session.header.origin !== 'subagent' &&
    (session.header.delegationDepth ?? 0) === 0
  )
}
