import { createHmac } from 'node:crypto'
import { basename } from 'node:path'

/** Persistable identity fields that cannot recover the canonical cwd. */
export interface DerivedProjectIdentity {
  aliasHash: string
  basename: string
  shortHash: string
}

/**
 * Derives a keyed alias and display fields from a canonical cwd.
 *
 * @param canonicalCwd Real project directory used only in memory.
 * @param localKey Plugin-local secret used for irreversible aliases.
 * @returns Persistable basename and keyed hashes without the cwd.
 */
export function deriveProjectIdentity(canonicalCwd: string, localKey: Uint8Array): DerivedProjectIdentity {
  const aliasHash = createHmac('sha256', localKey)
    .update('missher-memory:cwd\0')
    .update(canonicalCwd.normalize('NFC'))
    .digest('hex')
  return {
    aliasHash,
    basename: basename(canonicalCwd),
    shortHash: aliasHash.slice(0, 8),
  }
}
