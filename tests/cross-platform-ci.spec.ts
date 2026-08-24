import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const workflowPath = join(root, '.github', 'workflows', 'cross-platform.yml')

async function readWorkflow(): Promise<string> {
  return (await readFile(workflowPath, 'utf8')).replace(/\r\n?/gu, '\n')
}

describe('cross-platform CI contract', () => {
  it('runs the universal bundle on every supported native target', async () => {
    const workflow = await readWorkflow()

    for (const runner of ['macos-15-intel', 'macos-15', 'windows-2025', 'ubuntu-24.04']) {
      expect(workflow).toContain(`os: ${runner}`)
    }
    for (const platform of ['darwin-x64', 'darwin-arm64', 'win32-x64', 'linux-x64']) {
      expect(workflow).toContain(`platform: ${platform}`)
    }
    expect(workflow).toContain('name: Canonical universal package')
    expect(workflow).toContain('needs: package')
    expect(workflow).toContain('name: dsh-missher-memory-universal')
    expect(workflow).toContain('actions/download-artifact@v8')
    expect(workflow.match(/pnpm pack --pack-destination \.\/dist/gu)).toHaveLength(1)
    expect(workflow).toContain('fail-fast: false')
    expect(workflow).toContain('timeout-minutes: 45')
  })

  it('tests the package against the pinned current Harness CLI', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('repository: Missher12/deepseek-harness-desktop')
    expect(workflow).toContain('ref: a52c03b7c59a454dae2ac50a53115e35e72e0980')
    expect(workflow).toContain('node-version: 22.19.0')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm typecheck')
    expect(workflow).toContain('pnpm build')
    expect(workflow).toContain('scripts/verify-package.mjs')
    expect(workflow).toContain('scripts/native-smoke.mjs --platform ${{ matrix.platform }}')
    expect(workflow).toContain('--archive ./dist/universal/dsh-missher-memory-0.2.0.tgz')
    expect(workflow).toContain('--cli ./.harness-036/apps/cli/lib/bin.js')
    expect(workflow).toContain('NODE_OPTIONS: --max-old-space-size=6144')
  })

  it('uses read-only workflow permissions and preserves the evidence', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toContain('permissions:\n  contents: read')
    expect(workflow).not.toContain('pull_request_target:')
    expect(workflow).not.toContain('secrets.')
    expect(workflow.match(/persist-credentials: false/gu)).toHaveLength(3)
    expect(workflow).not.toContain('if: always()')
    expect(workflow).toContain('actions/upload-artifact@v7')
    expect(workflow).toContain('package-verification.json')
    expect(workflow).toContain('native-smoke.json')
  })

  it('keeps packaged text LF-only on Windows checkouts', async () => {
    await expect(readFile(join(root, '.gitattributes'), 'utf8')).resolves.toBe('* text=auto eol=lf\n')
  })
})
