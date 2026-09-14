#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import ts from 'typescript'

// Test-only snapshot of the existing Hub, never included in the Memory package.
const repo = resolve(process.argv[2])
const output = resolve(process.argv[3])
const sha = 'd1e8bd9c6d49f980405888099087f931ddd26d83'
const prefix = 'packages/brain/missher-brain/src/'
const names = ['index.ts', 'arbiter.ts', 'contracts.ts', 'injection.ts', 'registry.ts']
await mkdir(output, { recursive: true })
const files = []
for (const name of names) {
  const source = execFileSync('git', ['-C', repo, 'show', `${sha}:${prefix}${name}`])
  const compiled = ts.transpileModule(source.toString('utf8'), {
    fileName: name,
    compilerOptions: { target: ts.ScriptTarget.ES2024, module: ts.ModuleKind.ESNext, rewriteRelativeImportExtensions: true },
  }).outputText
  const target = name.replace(/\.ts$/, '.js')
  await writeFile(join(output, target), compiled)
  files.push({ source: prefix + name, sourceSha256: createHash('sha256').update(source).digest('hex'),
    output: target, outputSha256: createHash('sha256').update(compiled).digest('hex') })
}
await writeFile(join(output, 'package.json'), JSON.stringify({ private: true, type: 'module' }) + '\n')
await writeFile(join(output, 'provenance.json'), JSON.stringify({ sha, testOnly: true, sourceModified: false, files }, null, 2) + '\n')
process.stdout.write(join(output, 'index.js') + '\n')
