import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPackFiles } from './pack-check.ts'
import type { PackViolation } from './pack-check.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const COMPLIANT = [
  'package.json',
  'lib/index.js',
  'lib/client.js',
  'cordis.patch.yml',
  'CHANGELOG.md',
  'locale/zh.json',
]

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
  files: ['lib', 'locale', 'src', 'cordis.patch.yml', 'CHANGELOG.md'],
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

    for (const required of ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'CHANGELOG.md']) {
      const without = COMPLIANT.filter((file) => file !== required)
      expect({ required, pairs: pairs(checkPackFiles(without)) }).toEqual({
        required,
        pairs: [`${required}|missing`],
      })
    }

    expect(pairs(checkPackFiles(['lib/client.js.map', 'locale/zh.json']))).toEqual([
      'CHANGELOG.md|missing',
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

  it('A4 reports a list without CHANGELOG.md as missing exactly that entry', () => {
    expect(pairs(checkPackFiles(COMPLIANT.filter((file) => file !== 'CHANGELOG.md')))).toEqual(['CHANGELOG.md|missing'])
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
      'CHANGELOG.md': '## 1.0.0\n',
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

describe('published tarball content', () => {
  /** What the package shipped before the README: `lib/` only exists after a build, so the list is an upper bound. */
  const SHIPPED = [
    'package.json',
    'lib/index.js',
    'lib/client.js',
    'lib/client.js.map',
    'contract/index.d.ts',
    'cordis.patch.yml',
    'CHANGELOG.md',
    'locale/zh.json',
    'locale/en.json',
  ]

  const packedPaths = (): string[] => {
    const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as { files: { path: string }[] }[]
    return (report[0]?.files ?? []).map((file) => file.path)
  }

  it('A2 packs README.md, nothing under examples/ and no other file than the shipped set', () => {
    const paths = packedPaths()
    expect(paths).toContain('README.md')
    expect(paths.filter((path) => path.startsWith('examples/'))).toEqual([])
    expect(paths.filter((path) => path !== 'README.md' && !SHIPPED.includes(path))).toEqual([])
    expect(paths).toEqual(expect.arrayContaining(['package.json', 'contract/index.d.ts', 'cordis.patch.yml']))
  }, 120_000)

  it('A4 packs CHANGELOG.md', () => {
    expect(packedPaths()).toContain('CHANGELOG.md')
  }, 120_000)
})
