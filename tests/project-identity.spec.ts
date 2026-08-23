import { describe, expect, it } from 'vitest'
import { deriveProjectIdentity } from '../src/host/project-identity.ts'

describe('project identity derivation', () => {
  const localKey = Buffer.alloc(32, 7)

  it('persists only basename and irreversible hashes, never cwd', () => {
    const cwd = '/Users/example/projects/super-project'
    const identity = deriveProjectIdentity(cwd, localKey)

    expect(identity).toEqual({
      aliasHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      basename: 'super-project',
      shortHash: expect.stringMatching(/^[a-f0-9]{8}$/u),
    })
    expect(JSON.stringify(identity)).not.toContain(cwd)
    expect(JSON.stringify(identity)).not.toContain('/Users/')
  })

  it('is stable for one canonical cwd and distinct for another worktree', () => {
    const first = deriveProjectIdentity('/workspace/project', localKey)
    const repeated = deriveProjectIdentity('/workspace/project', localKey)
    const worktree = deriveProjectIdentity('/workspace/project-worktree', localKey)

    expect(first).toEqual(repeated)
    expect(first.aliasHash).not.toBe(worktree.aliasHash)
  })
})
