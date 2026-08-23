import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { truncateUtf8 } from './budget.ts'
import { inspectPrivacy } from './privacy.ts'

/** Minimal text retained in memory while candidate capture is explicitly enabled. */
export interface CapturedMessage {
  role: 'user' | 'assistant'
  text: string
}

/** Deployment-selected capture budgets below immutable privacy rejection. */
export interface CaptureBufferOptions {
  maxMessages: number
  maxSessionBytes: number
  maxMessageBytes: number
}

/** In-memory, bounded, tool-free session text collector. */
export class CaptureBuffer {
  readonly #options: CaptureBufferOptions
  readonly #messages = new Map<string, CapturedMessage[]>()
  readonly #sensitive = new Set<string>()

  /** Creates an empty buffer with validated lower budgets. */
  constructor(options: CaptureBufferOptions) {
    this.#options = {
      maxMessages: Math.max(1, Math.min(64, Math.floor(options.maxMessages))),
      maxSessionBytes: Math.max(1, Math.min(64_000, Math.floor(options.maxSessionBytes))),
      maxMessageBytes: Math.max(1, Math.min(4_000, Math.floor(options.maxMessageBytes))),
    }
  }

  /**
   * Adds eligible direct text to one session buffer.
   *
   * @param sessionId Durable session identity used only in process memory.
   * @param event Committed Harness session event.
   * @returns Acceptance, ordinary ignore, or whole-session sensitive rejection.
   */
  add(sessionId: string, event: SessionEvent): 'accepted' | 'ignored' | 'rejected-sensitive' {
    if (this.#sensitive.has(sessionId)) return 'rejected-sensitive'
    const message = extractMessage(event)
    if (message === undefined) return 'ignored'
    if (!inspectPrivacy(message.text).safe) {
      this.#messages.delete(sessionId)
      this.#sensitive.add(sessionId)
      return 'rejected-sensitive'
    }

    const messages = this.#messages.get(sessionId) ?? []
    if (messages.length >= this.#options.maxMessages) return 'ignored'
    const used = messages.reduce((total, item) => total + Buffer.byteLength(item.text, 'utf8'), 0)
    const remaining = this.#options.maxSessionBytes - used
    if (remaining <= 0) return 'ignored'
    const bounded = truncateUtf8(message.text, Math.min(remaining, this.#options.maxMessageBytes)).text
    if (bounded.length === 0) return 'ignored'
    messages.push({ role: message.role, text: bounded })
    this.#messages.set(sessionId, messages)
    return 'accepted'
  }

  /** Returns and forgets one session's text, or an empty list after sensitive rejection. */
  drain(sessionId: string): CapturedMessage[] {
    if (this.#sensitive.delete(sessionId)) return []
    const messages = this.#messages.get(sessionId) ?? []
    this.#messages.delete(sessionId)
    return messages
  }

  /** Clears all process-memory text during plugin teardown. */
  clear(): void {
    this.#messages.clear()
    this.#sensitive.clear()
  }
}

function extractMessage(event: SessionEvent): CapturedMessage | undefined {
  if (event.type === 'user/message') {
    if (event.data.source.kind !== 'user') return undefined
    const text = textContent(event.data.content)
    return text.length === 0 ? undefined : { role: 'user', text }
  }
  if (event.type === 'assistant/message') {
    const text = textContent(event.data.message.content)
    return text.length === 0 ? undefined : { role: 'assistant', text }
  }
  return undefined
}

function textContent(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}
