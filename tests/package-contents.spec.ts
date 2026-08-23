import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (['dist', 'lib', 'node_modules'].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await filesBelow(path))
    else files.push(path)
  }
  return files
}

describe('published bundle contract', () => {
  it('publishes only built runtime and operator documentation', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, unknown>

    expect(manifest.files).toEqual([
      'lib',
      'cordis.patch.yml',
      'README.md',
      'README.zh.md',
      'SECURITY.md',
      'DATA-RETENTION.md',
      'LICENSE',
    ])
    expect(manifest).not.toHaveProperty('scripts.prepare')
    expect(manifest).not.toHaveProperty('scripts.preinstall')
    expect(manifest).not.toHaveProperty('scripts.install')
    expect(manifest).not.toHaveProperty('scripts.postinstall')
  })

  it('contains no database, credential, log, or private-key artifact in source control', async () => {
    const files = await filesBelow(root)
    const names = files.map(file => basename(file))

    expect(names).not.toContain('vectors.db')
    expect(files).not.toContainEqual(expect.stringMatching(/\.(?:db|sqlite3?|log|pem|key)$/iu))
    expect(files).not.toContainEqual(expect.stringMatching(/(?:^|\/)\.env(?:\.|$)/iu))
  })

  it('keeps package verification and packaged smoke as explicit operator commands', async () => {
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(manifest.scripts['verify:package']).toBe('node scripts/verify-package.mjs')
    expect(manifest.scripts['smoke:package']).toBe('node scripts/native-smoke.mjs')
    await expect(readFile(join(root, 'scripts', 'verify-package.mjs'), 'utf8')).resolves.toContain('tar_path_invalid')
  })
})
