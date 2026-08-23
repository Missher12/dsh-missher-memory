import { defineConfig, type UserConfig } from 'tsdown'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { transform as transformCss } from 'lightningcss'
import ts from 'typescript'

const PLUGIN_ID = 'dsh-missher-memory'
const CSS_PREFIX = '\0missher-memory-css:'
const CSS_SUFFIX = '.mjs'
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0] ?? id
      if (!/\.[cm]?tsx?$/u.test(file) || !/^\s*@[A-Za-z_$][\w$]*/mu.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

function hostConfig(): UserConfig {
  return {
    entry: {
      index: 'src/index.ts',
      'typert.host': 'src/typert.host.ts',
      'typert.remote-client': 'src/typert.remote-client.ts',
      'workers/sqlite-reader.worker': 'src/workers/sqlite-reader.worker.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    plugins: [standardDecoratorPlugin()],
  }
}

function clientConfig(): UserConfig {
  return {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    noExternal: (id: string) => CLIENT_EXTERNALS.includes(id as never) ? undefined : true,
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [cssModulesInlinePlugin()],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-missher-memory", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

function cssModulesInlinePlugin() {
  const files = new Map<string, string>()
  return {
    name: 'missher-memory-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null
      const file = importer === undefined ? source : resolve(dirname(importer), source)
      const id = CSS_PREFIX + basename(file) + CSS_SUFFIX
      files.set(id, file)
      return id
    },
    async load(id: string) {
      if (!id.startsWith(CSS_PREFIX)) return null
      const file = files.get(id)
      if (file === undefined) throw new Error('missher-memory css module was not resolved')
      this.addWatchFile(file)
      const source = await readFile(file)
      const { code, exports: cssExports } = transformCss({
        filename: file,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classes: Record<string, string> = {}
      for (const [local, value] of Object.entries(cssExports ?? {})) classes[local] = value.name
      const tagId = `${PLUGIN_ID}/${basename(file)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        "if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {",
        "  const tag = document.createElement('style');",
        `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classes)};`,
      ].join('\n')
    },
  }
}

export default defineConfig(({ env }) => {
  if (env?.DSH_BUILD_FACE === 'host') return hostConfig()
  if (env?.DSH_BUILD_FACE === 'client') return clientConfig()
  throw new Error('tsdown: --env.DSH_BUILD_FACE must be host or client')
})
