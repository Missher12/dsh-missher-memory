#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createRequire } from 'node:module'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractVerifiedPackage, verifyPackage } from './verify-package.mjs'

const pluginRoot = resolve(import.meta.dirname, '..')
const PACKAGE_NAME = 'dsh-missher-memory'
const PLUGIN_NAME = 'missher-memory'

async function main() {
  let temporaryHome
  try {
    const options = parseArgs(process.argv.slice(2))
    assertCurrentPlatform(options.platform)
    const packageResult = await verifyPackage(options.archive)
    temporaryHome = await mkdtemp(join(tmpdir(), 'dsh-memory-native-'))
    const installed = await installPackage(options, temporaryHome)
    const synthetic = await createSyntheticFixture(temporaryHome)
    const beforeDatabase = await fileIdentity(synthetic.databasePath)

    const zeroHome = join(temporaryHome, 'zero-home')
    const zeroState = join(zeroHome, PLUGIN_NAME)
    const mounted = await mount(await loadRuntime(installed.pluginEntry), zeroHome, synthetic.databaseRoot)
    await mounted.core.noteCwd(synthetic.projectA)
    const initial = await mounted.remote.snapshot()
    if (initial.database.status !== 'ready' || initial.projectCandidate === null || initial.sources.length === 0) {
      throw new Error('initial_snapshot_invalid')
    }
    if (await exists(zeroState)) throw new Error('zero_state_created')

    const boundA = await mounted.remote.bindProject({
      candidateId: initial.projectCandidate.candidateId,
      sourceIds: initial.sources.map(source => source.sourceId),
    })
    if (boundA.project === null || boundA.project.captureEnabled || boundA.project.recallEnabled) {
      throw new Error('binding_defaults_invalid')
    }
    const firstSearch = await executeSearch(mounted.tool, synthetic.projectA, 'architecture')
    if (firstSearch.status !== 'ready' || firstSearch.results.length !== 1) throw new Error('search_invalid')

    await mounted.core.noteCwd(synthetic.projectB)
    const candidateB = await mounted.remote.snapshot()
    if (candidateB.projectCandidate === null) throw new Error('second_candidate_missing')
    await mounted.remote.bindProject({ candidateId: candidateB.projectCandidate.candidateId, sourceIds: [] })
    const isolatedSearch = await executeSearch(mounted.tool, synthetic.projectB, 'architecture')
    if (!['ready', 'project-unbound'].includes(isolatedSearch.status) || isolatedSearch.results.length !== 0) {
      throw new Error('cross_project_leak')
    }

    await mounted.core.noteCwd(synthetic.projectA)
    const reboundA = await mounted.remote.snapshot()
    if (reboundA.project === null) throw new Error('project_rebind_failed')
    await mounted.remote.updateSettings({ projectKey: reboundA.project.projectKey, captureEnabled: true })
    const session = { id: 'synthetic-session', header: { cwd: synthetic.projectA } }
    mounted.ctx.emit('session/event', session, {
      type: 'user/message',
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: '下一步完成独立安装包验收。' }],
      },
    })
    mounted.ctx.emit('session/disposed', session)
    const captured = await waitForCandidate(mounted.remote)
    await mounted.remote.reviewCandidate({ action: 'approve', candidateId: captured.candidateId })

    const lock = new DatabaseSync(synthetic.databasePath, { timeout: 250 })
    lock.exec('BEGIN EXCLUSIVE')
    let timeoutSearch
    try {
      timeoutSearch = await executeSearch(mounted.tool, synthetic.projectA, 'architecture')
    } finally {
      lock.exec('ROLLBACK')
      lock.close()
    }
    if (timeoutSearch.status !== 'timeout') throw new Error('timeout_not_enforced')

    const stateBytes = await readFile(join(zeroState, 'state.db'))
    for (const forbidden of [synthetic.projectA, synthetic.projectB, 'session-project-a']) {
      if (stateBytes.includes(Buffer.from(forbidden))) throw new Error('durable_identity_leak')
    }
    await mounted.dispose()

    const missingHome = join(temporaryHome, 'missing-home')
    const missing = await mount(await loadRuntime(installed.pluginEntry), missingHome, join(temporaryHome, 'missing-database'))
    await missing.core.noteCwd(synthetic.projectA)
    const missingSnapshot = await missing.remote.snapshot()
    if (missingSnapshot.database.status !== 'not-configured' || await exists(join(missingHome, PLUGIN_NAME))) {
      throw new Error('missing_database_invalid')
    }
    await missing.dispose()

    const corruptRoot = join(temporaryHome, 'corrupt-database')
    await mkdir(corruptRoot, { recursive: true })
    await writeFile(join(corruptRoot, 'vectors.db'), 'synthetic corrupt database\n', 'utf8')
    const corruptHome = join(temporaryHome, 'corrupt-home')
    const corrupt = await mount(await loadRuntime(installed.pluginEntry), corruptHome, corruptRoot)
    await corrupt.core.noteCwd(synthetic.projectA)
    const corruptSnapshot = await corrupt.remote.snapshot()
    if (corruptSnapshot.database.status !== 'corrupt' || await exists(join(corruptHome, PLUGIN_NAME))) {
      throw new Error('corrupt_database_invalid')
    }
    await corrupt.dispose()

    const afterDatabase = await fileIdentity(synthetic.databasePath)
    const databaseUnchanged = JSON.stringify(beforeDatabase) === JSON.stringify(afterDatabase)
    if (!databaseUnchanged) throw new Error('external_database_changed')

    await uninstallPackage(options, temporaryHome, installed)
    const uninstall = !await exists(installed.pluginDirectory)
    const statePreserved = await exists(join(zeroState, 'state.db'))
    const adjacentDataPreserved = await exists(installed.adjacentFile)
    const result = {
      ok: installed.profileInstall
        && uninstall
        && statePreserved
        && adjacentDataPreserved
        && databaseUnchanged,
      platform: process.platform,
      arch: process.arch,
      packageSha256: packageResult.sha256,
      profileMode: options.cli === undefined ? 'simulated' : 'native-cli',
      profileInstall: installed.profileInstall,
      zeroState: true,
      search: true,
      crossProjectIsolation: true,
      reviewedCapture: true,
      timeout: true,
      missingDatabase: true,
      corruptDatabase: true,
      uninstall,
      adjacentDataPreserved,
      statePreserved,
      databaseUnchanged,
    }
    if (!result.ok) throw new Error('acceptance_incomplete')
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: publicErrorCode(error),
      ...(process.env.DSH_SMOKE_DEBUG === '1' ? { diagnostic: publicDiagnostic(error) } : {}),
    })}\n`)
    process.exitCode = 1
  } finally {
    if (temporaryHome !== undefined) {
      await rm(temporaryHome, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

function parseArgs(args) {
  const options = {
    platform: 'current',
    archive: join(pluginRoot, 'dist', 'dsh-missher-memory-0.1.0.tgz'),
    cli: undefined,
    profile: 'memory-smoke',
  }
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    const value = args[index + 1]
    if (!['--platform', '--archive', '--cli', '--profile'].includes(key) || value === undefined) {
      throw new Error('arguments_invalid')
    }
    if (key === '--platform') options.platform = value
    if (key === '--archive') options.archive = resolve(value)
    if (key === '--cli') options.cli = resolve(value)
    if (key === '--profile') options.profile = value
    index += 1
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(options.profile)) throw new Error('profile_invalid')
  return options
}

function assertCurrentPlatform(requested) {
  const current = `${process.platform}-${process.arch}`
  const supported = new Set(['darwin-x64', 'darwin-arm64', 'win32-x64', 'linux-x64'])
  if (!supported.has(current) || (requested !== 'current' && requested !== current)) {
    throw new Error('platform_unsupported')
  }
}

async function installPackage(options, temporaryHome) {
  const profileDirectory = join(temporaryHome, 'profiles', options.profile)
  const pluginDirectory = join(profileDirectory, 'node_modules', PACKAGE_NAME)
  const adjacentFile = join(profileDirectory, 'adjacent-data.keep')
  if (options.cli !== undefined) {
    runCli(options.cli, temporaryHome, ['plugin', '--profile', options.profile, 'add', options.archive])
    const dump = runCli(options.cli, temporaryHome, ['--profile', options.profile, '--dump-config'])
    if (!dump.includes(PACKAGE_NAME) || !dump.includes(PLUGIN_NAME)) throw new Error('profile_composition_invalid')
    await access(join(pluginDirectory, 'lib', 'index.js'))
  } else {
    const staging = join(temporaryHome, 'extracted')
    await extractVerifiedPackage(options.archive, staging)
    await mkdir(dirname(pluginDirectory), { recursive: true })
    await rename(join(staging, 'package'), pluginDirectory)
    await symlink(join(pluginRoot, 'node_modules'), join(pluginDirectory, 'node_modules'), 'junction')
  }
  await mkdir(dirname(adjacentFile), { recursive: true })
  await writeFile(adjacentFile, 'preserve\n', 'utf8')
  return {
    pluginDirectory,
    pluginEntry: join(pluginDirectory, 'lib', 'index.js'),
    adjacentFile,
    profileInstall: true,
  }
}

async function uninstallPackage(options, temporaryHome, installed) {
  if (options.cli !== undefined) {
    runCli(options.cli, temporaryHome, ['plugin', '--profile', options.profile, 'remove', PACKAGE_NAME])
    const dump = runCli(options.cli, temporaryHome, ['--profile', options.profile, '--dump-config'])
    if (dump.includes(PACKAGE_NAME)) throw new Error('profile_uninstall_invalid')
  } else {
    await rm(installed.pluginDirectory, { recursive: true, force: true })
  }
}

function runCli(cli, home, args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: pluginRoot,
    env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  })
  if (result.status !== 0) {
    if (result.error !== undefined && 'code' in result.error && result.error.code === 'ETIMEDOUT') {
      throw new Error('harness_cli_timeout')
    }
    if (result.signal !== null) throw new Error(`harness_cli_signal_${String(result.signal).toLowerCase()}`)
    throw new Error(`harness_cli_exit_${String(result.status ?? 'unknown')}`)
  }
  return result.stdout
}

async function loadRuntime(pluginEntry) {
  const plugin = (await import(pathToFileURL(pluginEntry).href)).default
  const require = createRequire(pluginEntry)
  const cordisEntry = require.resolve('@deepseek-ai/cordis')
  const { Context } = await import(pathToFileURL(cordisEntry).href)
  return { Context, plugin }
}

async function mount(runtime, dshHome, databaseRoot) {
  const tools = new Map()
  const ctx = new runtime.Context()
  ctx.provide('tools', {
    register(tool) {
      tools.set(tool.name, tool)
      return () => tools.delete(tool.name)
    },
  })
  ctx.provide('dshHomePath', (...segments) => join(dshHome, ...segments))
  const previousRoot = process.env.MISSHER_TENCENTDB_DIR
  process.env.MISSHER_TENCENTDB_DIR = databaseRoot
  let fiber
  try {
    fiber = ctx.plugin(runtime.plugin, {
      enabled: true,
      captureEnabled: false,
      recallEnabled: false,
      searchTimeoutMs: 100,
      maxSearchResults: 5,
      searchByteBudget: 3_000,
      recallLimit: 2,
      recallByteBudget: 1_500,
    })
    await fiber.await()
  } finally {
    if (previousRoot === undefined) delete process.env.MISSHER_TENCENTDB_DIR
    else process.env.MISSHER_TENCENTDB_DIR = previousRoot
  }
  const tool = tools.get('memory_search')
  if (tool === undefined) throw new Error('memory_tool_missing')
  return {
    ctx,
    fiber,
    tool,
    core: ctx.missherMemoryCore,
    remote: ctx.missherMemory,
    async dispose() {
      await fiber.dispose()
      await ctx.fiber.dispose()
    },
  }
}

async function createSyntheticFixture(root) {
  const databaseRoot = join(root, 'synthetic-database')
  const projectA = join(root, 'project-a')
  const projectB = join(root, 'project-b')
  await Promise.all([
    mkdir(databaseRoot, { recursive: true }),
    mkdir(projectA, { recursive: true }),
    mkdir(projectB, { recursive: true }),
  ])
  const databasePath = join(databaseRoot, 'vectors.db')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    CREATE TABLE l1_records (
      record_id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      type TEXT,
      priority INTEGER,
      scene_name TEXT,
      session_key TEXT NOT NULL,
      session_id TEXT,
      timestamp TEXT,
      created_time TEXT,
      updated_time TEXT,
      metadata_json TEXT
    );
    CREATE VIRTUAL TABLE l1_fts USING fts5(record_id UNINDEXED, content);
    CREATE TABLE l0_conversations (
      record_id TEXT PRIMARY KEY,
      session_key TEXT NOT NULL,
      session_id TEXT,
      role TEXT,
      message_text TEXT NOT NULL,
      recorded_at TEXT,
      timestamp TEXT
    );
    CREATE VIRTUAL TABLE l0_fts USING fts5(record_id UNINDEXED, message_text);
    INSERT INTO l1_records (record_id, content, type, session_key, timestamp)
      VALUES ('synthetic-record', 'Synthetic architecture uses a read-only Worker.', 'decision', 'session-project-a', '2026-08-23T00:00:00Z');
    INSERT INTO l1_fts (record_id, content)
      VALUES ('synthetic-record', 'Synthetic architecture uses a read-only Worker.');
  `)
  database.close()
  return { databaseRoot, databasePath, projectA, projectB }
}

async function executeSearch(tool, cwd, query) {
  return tool.execute(
    { query, scope: 'project', limit: 5 },
    {
      agent: { session: { header: { cwd } } },
      signal: new AbortController().signal,
    },
  )
}

async function waitForCandidate(remote) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await remote.snapshot()
    const candidate = snapshot.candidates.find(item => item.status === 'pending')
    if (candidate !== undefined) return candidate
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('candidate_timeout')
}

async function fileIdentity(path) {
  const [metadata, bytes] = await Promise.all([stat(path), readFile(path)])
  return {
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function publicErrorCode(error) {
  const message = error instanceof Error ? error.message : ''
  return /^[a-z0-9_-]+$/u.test(message) ? message : 'native_smoke_failed'
}

function publicDiagnostic(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/gu, '[REDACTED_PATH]')
    .replace(/[\r\n\t]+/gu, ' ')
    .slice(0, 240)
}

await main()
