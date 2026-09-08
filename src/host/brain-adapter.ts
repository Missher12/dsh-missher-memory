import type { Context } from '@deepseek-ai/cordis'
import type { MemoryBrainProvider } from './brain-provider.ts'

/** Only this child plugin waits for Brain; removal does not stop manual memory tools. */
export const name = 'missher-memory-brain-adapter'
export const inject = ['missherBrain']

export function apply(ctx: Context, provider: MemoryBrainProvider): void {
  ctx.effect(() => ctx.missherBrain.register(provider), 'dsh-missher-memory: brain provider')
}

export default { name, inject, apply }
