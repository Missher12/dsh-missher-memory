import { describe, expect, it } from 'vitest'
import { CaptureBuffer } from '../src/host/capture-buffer.ts'

function userEvent(text: string, source: { kind: string } = { kind: 'user' }) {
  return {
    type: 'user/message',
    data: { role: 'user', source, content: [{ type: 'text', text }] },
  } as never
}

function assistantEvent(text: string) {
  return {
    type: 'assistant/message',
    data: {
      message: { role: 'assistant', source: { kind: 'model' }, content: [{ type: 'text', text }] },
    },
  } as never
}

describe('bounded candidate capture buffer', () => {
  it('accepts only direct user and assistant text, never plugin or tool content', () => {
    const buffer = new CaptureBuffer({ maxMessages: 4, maxSessionBytes: 2_000, maxMessageBytes: 500 })

    expect(buffer.add('session-a', userEvent('direct user text'))).toBe('accepted')
    expect(buffer.add('session-a', userEvent('plugin instructions', { kind: 'plugin' }))).toBe('ignored')
    expect(buffer.add('session-a', assistantEvent('assistant summary'))).toBe('accepted')
    expect(buffer.add('session-a', { type: 'tool/result', data: { message: { content: [] } } } as never)).toBe('ignored')

    expect(buffer.drain('session-a')).toEqual([
      { role: 'user', text: 'direct user text' },
      { role: 'assistant', text: 'assistant summary' },
    ])
  })

  it('marks the whole session sensitive and clears earlier buffered text', () => {
    const buffer = new CaptureBuffer({ maxMessages: 4, maxSessionBytes: 2_000, maxMessageBytes: 500 })
    buffer.add('session-a', userEvent('ordinary architecture note'))

    expect(buffer.add('session-a', userEvent('api_key=sk-test-' + 'x'.repeat(32)))).toBe('rejected-sensitive')
    expect(buffer.add('session-a', assistantEvent('later safe text'))).toBe('rejected-sensitive')
    expect(buffer.drain('session-a')).toEqual([])
  })

  it('enforces per-message, per-session, and count budgets at UTF-8 boundaries', () => {
    const buffer = new CaptureBuffer({ maxMessages: 2, maxSessionBytes: 12, maxMessageBytes: 9 })

    buffer.add('session-a', userEvent('架构决定继续'))
    buffer.add('session-a', assistantEvent('下一步测试'))
    buffer.add('session-a', assistantEvent('ignored third'))

    expect(buffer.drain('session-a')).toEqual([
      { role: 'user', text: '架构决' },
      { role: 'assistant', text: '下' },
    ])
  })

  it('drains once and leaves no durable state', () => {
    const buffer = new CaptureBuffer({ maxMessages: 4, maxSessionBytes: 2_000, maxMessageBytes: 500 })
    buffer.add('session-a', userEvent('progress'))

    expect(buffer.drain('session-a')).toHaveLength(1)
    expect(buffer.drain('session-a')).toEqual([])
  })
})
