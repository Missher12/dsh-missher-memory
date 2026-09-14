#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, cp, symlink, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyPackage } from './verify-package.mjs'

const archive = resolve(process.argv[2])
const cli = resolve(process.argv[3])
const defaults = process.argv[4] === '--defaults'
const brainUrl = defaults ? pathToFileURL(resolve(process.argv[5])).href : undefined
const cliRoot = resolve(dirname(cli), '..')
const cliManifest = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8'))
assert.equal(cliManifest.name, '@deepseek-ai/dsh')
assert.equal(cliManifest.version, '0.1.5-rc.2')
const require = createRequire(pathToFileURL(cli))
const runtimePackages = {}
for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-session', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-agent-loop']) {
  const manifest = JSON.parse(await readFile(require.resolve(`${name}/package.json`), 'utf8'))
  assert.equal(manifest.version, name === '@deepseek-ai/cordis' ? '4.0.2' : '0.1.5-rc.2')
  runtimePackages[name] = manifest.version
}
const verified = await verifyPackage(archive)
const root = await mkdtemp(join(tmpdir(), 'memory-official-s2-'))
const results = []
const env = {
  PATH: process.env.PATH, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
  HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), DSH_HOME: join(root, 'dsh'),
  MISSHER_TENCENTDB_DIR: join(root, 'absent-legacy'), DSH_TELEMETRY_DISABLED: '1',
  DSH_TELEMETRY_MODE: 'DISABLED', MEMORY_SMOKE_ROOT: root,
  ...(defaults ? { MEMORY_LOOPBACK_KEY: 'synthetic-loopback-only', MEMORY_SMOKE_BRAIN_URL: brainUrl } : {}),
}
function run(args, extra = {}) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...env, ...extra },
    encoding: 'utf8', timeout: 180_000, maxBuffer: 12 * 1024 * 1024 })
  if (r.status !== 0) throw new Error(`dsh ${args.join(' ')}: ${r.error ?? r.signal ?? r.status}\n${r.stdout}\n${r.stderr}`)
  return r.stdout
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  await mkdir(env.HOME)
  if (defaults) {
    await symlink(dirname(dirname(cliRoot)), join(root, 'node_modules'), 'junction')
    await cp(dirname(fileURLToPath(brainUrl)), join(root, 'brain'), { recursive: true })
    env.MEMORY_SMOKE_BRAIN_URL = pathToFileURL(join(root, 'brain', 'index.js')).href
  }
  run(['--profile', 'memory-s2', '--from-default-profile', 'headless', '--dump-config'])
  const probe = join(root, 'probe.mjs')
  await copyFile(new URL('./fixtures/official-memory-probe.mjs', import.meta.url), probe)
  const defaultsProbe = join(root, 'defaults-probe.mjs')
  if (defaults) await copyFile(new URL('./fixtures/official-defaults-probe.mjs', import.meta.url), defaultsProbe)
  const patch = [
    { id: 'headless-startup', disabled: true },
    { id: 'headless-runner', disabled: true },
    { id: 'tools', config: { mode: 'native' } },
    { insert: [{ id: 'memory-s2-probe', name: pathToFileURL(probe).href }] },
  ]
  const basePatch = join(root, 'probe.patch.json')
  await writeFile(basePatch, JSON.stringify(patch))
  const memoryPatch = join(root, 'memory.patch.json')
  await writeFile(memoryPatch, JSON.stringify([{ id: 'missher-memory', config: {
    enabled: true, captureEnabled: false, recallEnabled: false, consolidationEnabled: false,
  } }]))
  run(['plugin', '--profile', 'memory-s2', 'add', archive])
  assert.match(run(['--profile', 'memory-s2', '--dump-config']), /dsh-missher-memory/)
  const adjacent = join(env.DSH_HOME, 'adjacent.keep')
  await writeFile(adjacent, 'synthetic adjacent state\n')
  for (const phase of ['seed', 'absent', 'restore']) {
    if (defaults) {
      const phasePatch = patch.map(row => row.insert ? { insert: [{ id: 'memory-s2-probe', name: pathToFileURL(phase === 'absent' ? probe : defaultsProbe).href }] } : row)
      phasePatch.push({ id: 'llm-deepseek', disabled: true }, { id: 'session-title-llm', disabled: true })
      await writeFile(basePatch, JSON.stringify(phasePatch))
    }
    if (phase === 'absent') {
      run(['plugin', '--profile', 'memory-s2', 'remove', 'dsh-missher-memory'])
      assert.doesNotMatch(run(['--profile', 'memory-s2', '--dump-config']), /dsh-missher-memory/)
    }
    if (phase === 'restore') run(['plugin', '--profile', 'memory-s2', 'add', archive])
    const resultPath = join(root, `${phase}.json`)
    run(['--profile', 'memory-s2', '--patch', basePatch,
      ...(phase === 'absent' || defaults ? [] : ['--patch', memoryPatch])], {
      MEMORY_SMOKE_PHASE: phase, MEMORY_SMOKE_RESULT: resultPath,
    })
    results.push(JSON.parse(await readFile(resultPath, 'utf8')))
    if (phase === 'seed') {
      for (const name of ['state.db', 'key.bin']) {
        await writeFile(join(root, name + '.sha256'), hash(await readFile(join(env.DSH_HOME, 'missher-memory', name))))
      }
    }
    if (phase === 'absent') {
      for (const name of ['state.db', 'key.bin']) {
        assert.equal(hash(await readFile(join(env.DSH_HOME, 'missher-memory', name))), await readFile(join(root, name + '.sha256'), 'utf8'))
      }
    }
    assert.equal(await readFile(adjacent, 'utf8'), 'synthetic adjacent state\n')
  }
  process.stdout.write(JSON.stringify({ ok: true, officialVersion: cliManifest.version, platform: process.platform,
    arch: process.arch, mode: defaults ? 'defaults-with-optional-brain' : 'manual', runtimePackages, packageSha256: verified.sha256, phases: results, uninstallPreservedBytes: true,
    reinstallRestored: true, adjacentDataPreserved: true, syntheticDataOnly: true }) + '\n')
} finally {
  if (process.env.MEMORY_SMOKE_KEEP === '1') process.stderr.write(`Evidence home: ${root}\n`)
  else await rm(root, { recursive: true, force: true })
}
