import { truncateUtf8 } from './budget.ts'
import type { CapturedMessage } from './capture-buffer.ts'
import { inspectPrivacy } from './privacy.ts'
import type { CandidateDraft, CandidateKind, StateStore } from './state-store.ts'

type CandidateWriter = Pick<StateStore, 'createPendingCandidates'>

/** Deterministic, local-only conversion from bounded session text to review candidates. */
export class CandidateService {
  readonly #store: CandidateWriter

  constructor(store: CandidateWriter) {
    this.#store = store
  }

  /** Generates project-scoped candidates without an LLM and never throws into Harness. */
  async generate(
    projectKey: string,
    sessionId: string,
    messages: readonly CapturedMessage[],
  ): Promise<{ status: 'created'; candidateIds: string[] } | { status: 'no-candidate' | 'rejected-sensitive' | 'unavailable' }> {
    if (messages.length === 0) return { status: 'no-candidate' }
    if (messages.some((message) => !inspectPrivacy(message.text).safe)) return { status: 'rejected-sensitive' }

    const drafts: CandidateDraft[] = []
    for (const message of messages) {
      const content = truncateUtf8(message.text.trim(), 800).text
      if (content.length === 0) continue
      const kind = classify(content)
      drafts.push({ scope: 'project', kind, content })
      if (drafts.length >= 8) break
    }
    if (drafts.length === 0) return { status: 'no-candidate' }

    try {
      const result = await this.#store.createPendingCandidates(projectKey, sessionId, drafts)
      if (result.status === 'created' || result.status === 'no-candidate' || result.status === 'rejected-sensitive') {
        return result
      }
      return { status: 'unavailable' }
    } catch {
      return { status: 'unavailable' }
    }
  }
}

function classify(text: string): CandidateKind {
  if (/(?:架构|architecture|模块|边界|worker|数据库|data flow)/iu.test(text)) return 'architecture'
  if (/(?:决定|决策|采用|选择|decision|decided)/iu.test(text)) return 'decision'
  if (/(?:失败|报错|故障|踩坑|原因|修复|failed|failure|error|root cause)/iu.test(text)) return 'failure'
  if (/(?:下一步|待办|随后|接下来|next|todo|follow[- ]?up)/iu.test(text)) return 'next'
  if (/(?:偏好|约定|规范|风格|preference|convention)/iu.test(text)) return 'project-preference'
  return 'progress'
}
