import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const packageJsonUrl = new URL('../package.json', import.meta.url)
const cordisPatchUrl = new URL('../cordis.patch.yml', import.meta.url)

describe('standalone bundle manifest', () => {
  it('exposes the Host, Client, Remote, and Typert entrypoints', async () => {
    const manifest = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as Record<string, unknown>

    expect(manifest).toMatchObject({
      name: 'dsh-missher-memory',
      private: false,
      type: 'module',
      repository: {
        type: 'git',
        url: 'git+https://github.com/Missher12/dsh-missher-memory.git',
      },
      homepage: 'https://github.com/Missher12/dsh-missher-memory#readme',
      bugs: { url: 'https://github.com/Missher12/dsh-missher-memory/issues' },
      engines: { node: '^22.19.0 || >=24.0.0' },
      main: 'lib/index.js',
      types: 'lib/index.d.ts',
      exports: {
        '.': { types: './lib/index.d.ts', import: './lib/index.js' },
        './typert': { types: './lib/typert.host.d.ts', default: './lib/typert.host.js' },
        './remote': {
          types: './lib/typert.remote-client.d.ts',
          default: './lib/typert.remote-client.js',
        },
        './client': { default: './lib/client.js' },
        './package.json': './package.json',
      },
      files: ['lib', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'SECURITY.md', 'DATA-RETENTION.md', 'LICENSE'],
      dsh: {
        bundle: { patch: './cordis.patch.yml' },
        client: {
          inject: [
            '@deepseek-ai/dsh-client-runtime',
            '@deepseek-ai/dsh-client-ui-settings',
            '@deepseek-ai/dsh-client-locale',
            '@deepseek-ai/dsh-api-remotes',
          ],
          platform: 'web',
        },
      },
    })
  })

  it('has no install lifecycle and keeps all Harness runtime packages optional peers', async () => {
    const manifest = JSON.parse(await readFile(packageJsonUrl, 'utf8')) as {
      scripts?: Record<string, string>
      peerDependencies?: Record<string, string>
      peerDependenciesMeta?: Record<string, { optional?: boolean }>
    }

    for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(manifest.scripts?.[script]).toBeUndefined()
    }

    const expectedPeers = [
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-agent-loop',
      '@deepseek-ai/dsh-api-remotes',
      '@deepseek-ai/dsh-client-locale',
      '@deepseek-ai/dsh-client-runtime',
      '@deepseek-ai/dsh-client-ui-settings',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-session',
      '@deepseek-ai/dsh-tools',
      '@deepseek-ai/dsh-typert-protocol',
      '@deepseek-ai/schemastery',
      'react',
      'zod',
    ]
    expect(Object.keys(manifest.peerDependencies ?? {}).sort()).toEqual(expectedPeers.sort())
    for (const name of expectedPeers.filter((peer) => peer !== 'react' && peer !== 'zod')) {
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true)
    }
  })

  it('adds one enabled memory plugin entry to the bundle patch', async () => {
    const patch = await readFile(cordisPatchUrl, 'utf8')

    expect(patch).toContain('id: missher-memory')
    expect(patch).toContain('name: dsh-missher-memory')
    expect(patch).toContain('captureEnabled: false')
    expect(patch).toContain('recallEnabled: false')
  })
})
