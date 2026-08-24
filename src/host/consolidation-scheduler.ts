import type { ConsolidationService } from './consolidation-service.ts'
import type { StateStore } from './state-store.ts'

const DAY_MS = 24 * 60 * 60 * 1_000

/** One low-frequency unref'ed scheduler; duplicate-only work is bounded per project. */
export class ConsolidationScheduler {
  readonly #state: Pick<StateStore, 'listProjects'>
  readonly #service: Pick<ConsolidationService, 'runProject'>
  #timer: NodeJS.Timeout | undefined
  #running = false
  #disposed = false

  constructor(options: {
    state: Pick<StateStore, 'listProjects'>
    service: Pick<ConsolidationService, 'runProject'>
  }) {
    this.#state = options.state
    this.#service = options.service
  }

  start(): void {
    if (this.#timer !== undefined || this.#disposed) return
    this.#schedule(30_000)
  }

  async runOnce(): Promise<void> {
    if (this.#running || this.#disposed) return
    this.#running = true
    try {
      const projects = await this.#state.listProjects()
      for (const project of projects.slice(0, 64)) {
        if (this.#disposed) return
        await this.#service.runProject(project.projectKey, 'automatic')
      }
    } catch {
      // Automatic maintenance must never affect Harness startup or conversations.
    } finally {
      this.#running = false
    }
  }

  dispose(): void {
    this.#disposed = true
    if (this.#timer !== undefined) clearTimeout(this.#timer)
    this.#timer = undefined
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      void this.runOnce().finally(() => {
        if (!this.#disposed) this.#schedule(DAY_MS)
      })
    }, delay)
    this.#timer.unref()
  }
}
