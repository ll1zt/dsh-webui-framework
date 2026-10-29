import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPackFiles } from './pack-check.ts'
import type { PackViolation } from './pack-check.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const COMPLIANT = ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'locale/zh.json']

/** (file, reason) pairs as a sorted set, so a duplicated report is not a failure but a missing one is. */
const pairs = (violations: readonly PackViolation[]): string[] =>
  [...new Set(violations.map((violation) => `${violation.file}|${violation.reason}`))].sort()

const fixtureDirs: string[] = []

const makePackageFixture = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-check-fixture-'))
  fixtureDirs.push(dir)
  for (const [relative, content] of Object.entries(files)) {
    const target = join(dir, relative)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return dir
}

const runPackCheck = (dir: string) =>
  spawnSync(process.execPath, ['scripts/pack-check.ts', dir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })

const MANIFEST = JSON.stringify({
  name: 'pack-check-fixture',
  version: '1.0.0',
  files: ['lib', 'locale', 'src', 'cordis.patch.yml'],
})

afterEach(() => {
  while (fixtureDirs.length > 0) {
    const dir = fixtureDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('checkPackFiles', () => {
  it('A1 reports every required entry a list is missing', () => {
    expect(checkPackFiles(COMPLIANT)).toEqual([])

    for (const required of ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml']) {
      const without = COMPLIANT.filter((file) => file !== required)
      expect({ required, pairs: pairs(checkPackFiles(without)) }).toEqual({
        required,
        pairs: [`${required}|missing`],
      })
    }

    expect(pairs(checkPackFiles(['lib/client.js.map', 'locale/zh.json']))).toEqual([
      'cordis.patch.yml|missing',
      'lib/client.js|missing',
      'lib/index.js|missing',
      'package.json|missing',
    ])
  })

  it('A1 rejects source, docs, scripts and dependency paths plus local and test files', () => {
    const forbidden = [
      'src/a.ts',
      'src/client/index.ts',
      'scripts/pack-check.ts',
      'docs/x.local.md',
      'ref/deepseek-harness/package.json',
      'node_modules/react/index.js',
      'README.local.md',
      'a.test.ts',
      'lib/client.test.js',
    ]

    for (const file of forbidden) {
      const violations = checkPackFiles([...COMPLIANT, file])
      expect({ file, pairs: pairs(violations) }).toEqual({ file, pairs: [`${file}|forbidden`] })
    }
  })

  it('A1 accepts a compliant list that also carries allowed files', () => {
    const allowed = [
      'lib/client.js.map',
      'lib/client.abc123.js',
      'locale/zh.json',
      'locale/en.json',
      'README.md',
      'LICENSE',
      'package-lock.json',
    ]
    expect(checkPackFiles([...COMPLIANT, ...allowed])).toEqual([])
    expect(checkPackFiles([...COMPLIANT, 'lib/client.js.map', 'locale/en.json'])).toEqual([])
  })

  it('A1 cli exits 1 and names the offending file for a forbidden packed path', () => {
    const dir = makePackageFixture({
      'package.json': MANIFEST,
      'lib/index.js': 'export const apply = () => {}\n',
      'lib/client.js': 'window.__ModuleLoader__.load({})\n',
      'cordis.patch.yml': '- id: pi-ui\n',
      'src/a.ts': 'export const leaked = true\n',
    })

    const result = runPackCheck(dir)
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
    expect(result.status).toBe(1)
    expect(output).toContain('src/a.ts')
    expect(output).toContain('forbidden')
  })

  it('A1 cli exits 0 for a package whose packed files are all allowed', () => {
    const dir = makePackageFixture({
      'package.json': MANIFEST,
      'lib/index.js': 'export const apply = () => {}\n',
      'lib/client.js': 'window.__ModuleLoader__.load({})\n',
      'cordis.patch.yml': '- id: pi-ui\n',
      'locale/zh.json': '{}\n',
    })

    const result = runPackCheck(dir)
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).not.toContain('forbidden')
    expect(result.status).toBe(0)
  })
})

describe('package manifest deliverable scripts', () => {
  interface Manifest {
    scripts?: Record<string, string>
  }

  const manifest = (): Manifest => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest

  it('A2 declares prepack as npm run build and pack:check as the script run', () => {
    const scripts = manifest().scripts ?? {}
    expect(scripts.prepack).toBe('npm run build')
    expect(scripts['pack:check']).toBe('node scripts/pack-check.ts')
  })
})

describe('contract subpath', () => {
  interface ContractManifest {
    exports?: Record<string, unknown>
    files?: string[]
  }

  const manifest = (): ContractManifest =>
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as ContractManifest

  it('A4 exports ./contract with the types condition only and packs the .d.ts', () => {
    expect(manifest().exports?.['./contract']).toEqual({ types: './contract/index.d.ts' })
    expect(manifest().files).toContain('contract/index.d.ts')
  })

  it('A4 pack-check allows contract/index.d.ts and reports a .js under contract/ as forbidden', () => {
    expect(checkPackFiles([...COMPLIANT, 'contract/index.d.ts'])).toEqual([])
    expect(pairs(checkPackFiles([...COMPLIANT, 'contract/index.d.ts', 'contract/index.js']))).toEqual([
      'contract/index.js|forbidden',
    ])
  })
})
