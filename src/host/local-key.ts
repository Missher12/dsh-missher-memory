import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

const KEY_BYTES = 32

/** Safe local-key load state. */
export type LocalKeyResult =
  | { status: 'ready'; key: Buffer }
  | { status: 'missing' | 'unsafe-state' | 'corrupt' | 'unavailable' }

/** Returns the key file path under a validated state directory. */
export function localKeyPath(stateDirectory: string): string {
  return join(stateDirectory, 'key.bin')
}

/**
 * Reads an existing plugin key without creating directories or files.
 *
 * @param stateDirectory Absolute plugin state directory.
 * @returns Existing 32-byte key or a safe state.
 */
export async function loadLocalKey(stateDirectory: string): Promise<LocalKeyResult> {
  if (!isAbsolute(stateDirectory)) return { status: 'unsafe-state' }
  try {
    const directory = await lstat(stateDirectory)
    if (!directory.isDirectory() || directory.isSymbolicLink()) return { status: 'unsafe-state' }
    const keyEntry = await lstat(localKeyPath(stateDirectory))
    if (!keyEntry.isFile() || keyEntry.isSymbolicLink()) return { status: 'unsafe-state' }
    const key = await readFile(localKeyPath(stateDirectory))
    if (key.length !== KEY_BYTES) return { status: 'corrupt' }
    return { status: 'ready', key }
  } catch (error) {
    if (isMissing(error)) return { status: 'missing' }
    return { status: 'unavailable' }
  }
}

/**
 * Creates the private state directory and key only for an explicit mutation.
 *
 * @param stateDirectory Absolute plugin state directory.
 * @returns Existing or newly generated key.
 */
export async function loadOrCreateLocalKey(stateDirectory: string): Promise<LocalKeyResult> {
  if (!isAbsolute(stateDirectory)) return { status: 'unsafe-state' }
  const existing = await loadLocalKey(stateDirectory)
  if (existing.status === 'ready' || existing.status === 'unsafe-state' || existing.status === 'corrupt') return existing

  try {
    try {
      const entry = await lstat(stateDirectory)
      if (!entry.isDirectory() || entry.isSymbolicLink()) return { status: 'unsafe-state' }
    } catch (error) {
      if (!isMissing(error)) return { status: 'unavailable' }
      await mkdir(stateDirectory, { recursive: true, mode: 0o700 })
    }
    await chmod(stateDirectory, 0o700)
    const key = randomBytes(KEY_BYTES)
    let handle
    try {
      handle = await open(localKeyPath(stateDirectory), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      await handle.writeFile(key)
      await handle.sync()
    } catch (error) {
      if (isExists(error)) return loadLocalKey(stateDirectory)
      return { status: 'unavailable' }
    } finally {
      await handle?.close()
    }
    await chmod(localKeyPath(stateDirectory), 0o600)
    return { status: 'ready', key }
  } catch {
    return { status: 'unavailable' }
  }
}

/** Returns a keyed stable digest for a session identifier. */
export function hashSessionKey(localKey: Uint8Array, sessionKey: string): string {
  return createHmac('sha256', localKey).update('missher-memory:session\0').update(sessionKey).digest('hex')
}

/** Returns a keyed fingerprint used to detect key replacement. */
export function keyFingerprint(localKey: Uint8Array): string {
  return createHmac('sha256', localKey).update('missher-memory:key-check').digest('hex')
}

/** Encrypts one external session identifier for exact database filtering. */
export function encryptSessionKey(localKey: Uint8Array, sessionKey: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', localKey, nonce)
  const encrypted = Buffer.concat([cipher.update(sessionKey, 'utf8'), cipher.final()])
  return ['v1', nonce.toString('base64'), encrypted.toString('base64'), cipher.getAuthTag().toString('base64')].join(':')
}

/** Decrypts one authenticated external session identifier. */
export function decryptSessionKey(localKey: Uint8Array, encoded: string): string {
  const [version, nonceText, ciphertextText, tagText, extra] = encoded.split(':')
  if (version !== 'v1' || nonceText === undefined || ciphertextText === undefined || tagText === undefined || extra !== undefined) {
    throw new Error('invalid session ciphertext')
  }
  const nonce = Buffer.from(nonceText, 'base64')
  const ciphertext = Buffer.from(ciphertextText, 'base64')
  const tag = Buffer.from(tagText, 'base64')
  if (nonce.length !== 12 || tag.length !== 16) throw new Error('invalid session ciphertext')
  const decipher = createDecipheriv('aes-256-gcm', localKey, nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function isExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
