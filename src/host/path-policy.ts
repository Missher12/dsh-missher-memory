import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import type { DatabasePathSource } from '../shared/types.ts'

/** Inputs used to locate the external memory database without creating it. */
export interface MemoryDatabasePathOptions {
  overrideRoot?: string | undefined
  homeDirectory?: string | undefined
}

/** Result of resolving the external database under the strict path policy. */
export type ResolvedMemoryDatabase =
  | {
      ok: true
      rootPath: string
      databasePath: string
      source: DatabasePathSource
    }
  | {
      ok: false
      code: 'not-configured' | 'unsafe-path'
      source: DatabasePathSource
    }

function isContained(rootPath: string, childPath: string): boolean {
  const segment = relative(rootPath, childPath)
  return segment !== '' && segment !== '..' && !segment.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(segment)
}

async function isRegularDirectoryWithoutLinks(path: string): Promise<boolean> {
  const entry = await lstat(path)
  return entry.isDirectory() && !entry.isSymbolicLink()
}

async function isRegularFileWithoutLinks(path: string): Promise<boolean> {
  const entry = await lstat(path)
  return entry.isFile() && !entry.isSymbolicLink()
}

/**
 * Resolves an existing `vectors.db` while rejecting links, escape paths, and creation.
 *
 * @param options Environment override and home directory inputs.
 * @returns A canonical existing database path or a non-sensitive public error.
 */
export async function resolveMemoryDatabase(options: MemoryDatabasePathOptions = {}): Promise<ResolvedMemoryDatabase> {
  const source: DatabasePathSource = options.overrideRoot === undefined ? 'default' : 'environment'
  const rootPath = options.overrideRoot ?? join(options.homeDirectory ?? homedir(), '.local', 'share', 'missher-memory', 'tencentdb')
  if (!isAbsolute(rootPath)) return { ok: false, code: 'unsafe-path', source }

  try {
    if (!(await isRegularDirectoryWithoutLinks(rootPath))) return { ok: false, code: 'unsafe-path', source }
  } catch (error) {
    if (isMissing(error)) return { ok: false, code: 'not-configured', source }
    return { ok: false, code: 'unsafe-path', source }
  }

  const canonicalRoot = await realpath(rootPath)
  const databasePath = join(canonicalRoot, 'vectors.db')
  try {
    if (!(await isRegularFileWithoutLinks(databasePath))) return { ok: false, code: 'unsafe-path', source }
  } catch (error) {
    if (isMissing(error)) return { ok: false, code: 'not-configured', source }
    return { ok: false, code: 'unsafe-path', source }
  }

  const canonicalDatabase = await realpath(databasePath)
  if (!isContained(canonicalRoot, canonicalDatabase)) return { ok: false, code: 'unsafe-path', source }
  return { ok: true, rootPath: canonicalRoot, databasePath: canonicalDatabase, source }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
