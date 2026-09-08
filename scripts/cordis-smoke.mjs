#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractVerifiedPackage } from './verify-package.mjs'

const archive = resolve(process.argv[2] ?? '')
const root = await mkdtemp(join(tmpdir(), 'memory-cordis-package-'))
const require = createRequire(import.meta.url)
const results = []
try {
  const verified = await extractVerifiedPackage(archive, join(root, 'installed'))
  const entry = pathToFileURL(join(root, 'installed', 'package', 'lib', 'core.js')).href
  // No dependency symlinks are installed beside the extracted core.
  const { default: plugin, getMemoryService, MemoryService } = await import(entry)
  for (const packageName of ['cordis', '@deepseek-ai/cordis']) {
    const { Context } = await import(pathToFileURL(require.resolve(packageName)).href)
    const version = JSON.parse(await readFile(require.resolve(`${packageName}/package.json`), 'utf8')).version
    const ctx = new Context()
    const home = join(root, packageName.replaceAll('/', '-'), 'home')
    const cwd = join(home, 'project')
    await mkdir(cwd, { recursive: true })
    const stateDirectory = join(home, 'state')
    let fiber
    try {
      fiber = ctx.plugin(plugin, { stateDirectory })
      await fiber.await()
      const service = getMemoryService(ctx)
      assert.equal(ctx.get('tools'), undefined)
      assert.equal(ctx.get('dshHomePath'), undefined)
      assert.equal(ctx.get('missherBrain'), undefined)
      assert.equal((await service.status()).hasState, false)
      assert.equal((await service.bindProject({ cwd, sessionKeys: [] })).status, 'bound')
      const created = await service.project(cwd).propose({
        sourceId: 'synthetic-cordis-smoke',
        drafts: [{ scope: 'project', kind: 'architecture', content: 'architecture uses project scoped queues' }],
      })
      assert.equal(created.status, 'created')
      assert.equal((await service.project(cwd).search({ query: 'architecture' })).results.length, 0)
      assert.equal((await service.admin(cwd).approve(created.candidateIds[0])).status, 'approved')
      const searched = await service.project(cwd).search({ query: 'architecture' })
      assert.equal(searched.results.length, 1)
      assert.deepEqual((await service.project(cwd).get(searched.results[0].reference)).memory.sourceReferences, created.candidateIds)
      await fiber.dispose()
      assert.equal(ctx.get('missherMemoryService'), undefined)
      assert.equal((await service.project(cwd).search({ query: 'architecture' })).status, 'unavailable')
      fiber = ctx.plugin(plugin, { stateDirectory })
      await fiber.await()
      assert.equal((await getMemoryService(ctx).project(cwd).search({ query: 'architecture' })).results.length, 1)
      results.push({ packageName, version, lifecycle: true, noHarnessServices: true })
    } finally {
      await ctx.fiber.dispose()
    }
  }

  // Independent processes exercise SQLite initialization and repeated review of the same candidate.
  const shared = join(root, 'concurrent')
  const cwd = join(shared, 'project')
  const stateDirectory = join(shared, 'state')
  await mkdir(cwd, { recursive: true })
  const childScript = `
    import { MemoryService } from ${JSON.stringify(entry)};
    const service = new MemoryService(${JSON.stringify({ stateDirectory })});
    const bound = await service.bindProject({ cwd: ${JSON.stringify(cwd)}, sessionKeys: [] });
    const created = await service.project(${JSON.stringify(cwd)}).propose({ sourceId: 'same-source', drafts: [{ scope: 'project', kind: 'decision', content: 'concurrent review keeps one approved memory' }] });
    const review = created.status === 'created' ? await service.admin(${JSON.stringify(cwd)}).approve(created.candidateIds[0]) : created;
    await service.close();
    process.stdout.write(JSON.stringify({ bound: bound.status, created: created.status, review: review.status }));
  `
  const concurrency = await Promise.all(Array.from({ length: 4 }, () => runChild(childScript, root)))
  for (const result of concurrency) {
    assert.equal(result.bound, 'bound')
    assert.equal(result.created, 'created')
    assert.ok(['approved', 'not-pending'].includes(result.review))
  }
  assert.equal(concurrency.filter(result => result.review === 'approved').length, 1)
  const service = new MemoryService({ stateDirectory })
  try {
    assert.equal((await service.project(cwd).search({ query: 'concurrent' })).results.length, 1)
  } finally { await service.close() }
  process.stdout.write(JSON.stringify({ ok: true, platform: process.platform, arch: process.arch, packageSha256: verified.sha256,
    runtimes: results, isolatedPackageImport: true, concurrentProcesses: 4, singleApproval: true,
    realAgentInvocationVerified: false }) + '\n')
} finally {
  await rm(root, { recursive: true, force: true })
}

function runChild(script, directory) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: directory, env: { ...process.env, DSH_HOME: join(directory, 'child-home') }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let errorOutput = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { errorOutput += chunk })
    const timeout = setTimeout(() => child.kill(), 20_000)
    child.on('error', error => { clearTimeout(timeout); reject(error) })
    child.on('close', code => {
      clearTimeout(timeout)
      if (code !== 0) return reject(new Error(`core_child_failed:${code}:${errorOutput}`))
      try { resolveResult(JSON.parse(output)) } catch (error) { reject(error) }
    })
  })
}
