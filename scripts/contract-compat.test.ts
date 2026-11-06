import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { compilePreviousFixtures } from './contract-compat.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PREVIOUS = join(ROOT, 'scripts/fixtures/contract/previous')
const CONTRACT = '@lllzt/dsh-webui-framework/contract'
const MISSING_TYPE = 'NotARealContractType'

const copies: string[] = []

const read = (path: string): string => readFileSync(path, 'utf8')

/** Paths of `*.fixture.txt` under `dir`, relative to `dir`, in code-point order. */
const fixtureNames = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const found: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.fixture.txt')) found.push(relative(dir, path))
    }
  }
  walk(dir)
  return found.sort()
}

const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'contract-compat-'))
  copies.push(dir)
  return dir
}

/** Body of one changelog section, from its `## <version>` heading through the line before the next heading. */
const changelogSection = (markdown: string, version: string): string | undefined => {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `))
  if (start < 0) return undefined
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start, next < 0 ? lines.length : next).join('\n')
}

const packageVersion = (root: string): string => {
  const manifest = JSON.parse(read(join(root, 'package.json'))) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('package.json has no version')
  return manifest.version
}

/** The current version's changelog section declares an incompatible contract change. */
const declaresIncompatible = (section: string): boolean => /不兼容|\bincompatible\b/i.test(section)

/**
 * Previous fixtures may fail only when the current changelog section declares the break.
 * Otherwise the error names every failing fixture, in the order `compilePreviousFixtures` returned.
 */
const assertPreviousCompatible = (root: string): void => {
  const failures = compilePreviousFixtures(root)
  if (failures.length === 0) return
  const version = packageVersion(root)
  const section = changelogSection(read(join(root, 'CHANGELOG.md')), version) ?? ''
  if (declaresIncompatible(section)) return
  throw new Error(
    `previous fixtures failed and CHANGELOG ${version} does not declare 不兼容:\n${failures
      .map((failure) => failure.fixture)
      .join('\n')}`,
  )
}

const writeTree = (root: string, version: string, changelog: string, files: Record<string, string>): void => {
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ version })}\n`)
  writeFileSync(join(root, 'CHANGELOG.md'), changelog)
  for (const [name, text] of Object.entries(files)) {
    const path = join(root, 'scripts/fixtures/contract/previous', name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  }
}

const missingTypeFixture = (): string =>
  [`import type { ${MISSING_TYPE} } from '${CONTRACT}'`, `export type Probe = ${MISSING_TYPE}`, ''].join('\n')

afterEach(() => {
  while (copies.length > 0) {
    const dir = copies.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('previous contract fixtures', () => {
  it('A1 previous fixtures compile to an empty failure list', () => {
    const names = fixtureNames(PREVIOUS)
    expect(names.length).toBeGreaterThanOrEqual(2)
    const sources = names.map((name) => read(join(PREVIOUS, name)))
    expect(
      sources.some(
        (source) =>
          source.includes(CONTRACT) &&
          source.includes('BlockMeta') &&
          source.includes('registerBlock') &&
          /preset/i.test(source),
      ),
    ).toBe(true)
    expect(
      sources.some(
        (source) =>
          source.includes('WebuiSession') &&
          source.includes('SessionActionResult') &&
          source.includes('SessionBlockProps') &&
          source.includes('.ok') &&
          source.includes('reason'),
      ),
    ).toBe(true)
    expect(compilePreviousFixtures(ROOT)).toEqual([])
  }, 60_000)

  it('A2 a fixture that imports a missing type returns exactly one diagnostic', () => {
    const names = fixtureNames(PREVIOUS)
    expect(names.length).toBeGreaterThan(0)
    const broken = names[0]
    if (broken === undefined) throw new Error('no previous fixture')
    const root = tempDir()
    cpSync(PREVIOUS, join(root, 'scripts/fixtures/contract/previous'), { recursive: true })
    const brokenPath = join(root, 'scripts/fixtures/contract/previous', broken)
    writeFileSync(brokenPath, `${read(brokenPath)}\n${missingTypeFixture()}`)
    const failures = compilePreviousFixtures(root)
    expect(failures).toHaveLength(1)
    const failure = failures[0]
    if (failure === undefined) throw new Error('missing failure')
    const fixturePath = failure.fixture.replaceAll('\\', '/')
    const namesFile = (name: string): boolean =>
      fixturePath === name.replaceAll('\\', '/') || fixturePath.endsWith(`/${name.replaceAll('\\', '/')}`)
    expect(namesFile(broken)).toBe(true)
    const brokenRel = broken.replaceAll('\\', '/')
    for (const other of names.slice(1)) {
      const otherRel = other.replaceAll('\\', '/')
      if (otherRel === brokenRel || brokenRel.endsWith(`/${otherRel}`)) continue
      expect(namesFile(other)).toBe(false)
    }
    expect(failure.message).toContain(MISSING_TYPE)
    expect(failure.message).toMatch(/TS2305/)
  }, 60_000)

  it('A3 failing fixtures are listed unless the changelog declares 不兼容', () => {
    const broken = {
      'a-missing.fixture.txt': missingTypeFixture(),
      'b-missing.fixture.txt': missingTypeFixture(),
    }
    const olderDeclaresIt = ['## 0.0.1', '', 'This is an incompatible change. 不兼容', ''].join('\n')

    const undeclared = tempDir()
    writeTree(
      undeclared,
      '9.9.9',
      ['## 9.9.9', '', 'Adds a helper. Backwards compatible.', '', olderDeclaresIt].join('\n'),
      broken,
    )
    const failures = compilePreviousFixtures(undeclared)
    expect(failures).toHaveLength(2)
    expect(failures.map((failure) => failure.fixture)).toEqual([...failures.map((failure) => failure.fixture)].sort())
    expect(() => assertPreviousCompatible(undeclared)).toThrow(/a-missing\.fixture\.txt[\s\S]*b-missing\.fixture\.txt/)

    const inChinese = tempDir()
    writeTree(inChinese, '9.9.9', ['## 9.9.9', '', 'This change is 不兼容.', ''].join('\n'), {
      'a-missing.fixture.txt': missingTypeFixture(),
    })
    expect(compilePreviousFixtures(inChinese).length).toBeGreaterThan(0)
    expect(() => assertPreviousCompatible(inChinese)).not.toThrow()

    const inEnglish = tempDir()
    writeTree(inEnglish, '9.9.9', ['## 9.9.9', '', 'This is an incompatible change.', ''].join('\n'), {
      'a-missing.fixture.txt': missingTypeFixture(),
    })
    expect(compilePreviousFixtures(inEnglish).length).toBeGreaterThan(0)
    expect(() => assertPreviousCompatible(inEnglish)).not.toThrow()

    const compatible = tempDir()
    writeTree(compatible, '9.9.9', ['## 9.9.9', '', 'Adds a helper.', ''].join('\n'), {
      'ok.fixture.txt': read(join(ROOT, 'scripts/fixtures/contract/ok.fixture.txt')),
    })
    expect(compilePreviousFixtures(compatible)).toEqual([])
    expect(() => assertPreviousCompatible(compatible)).not.toThrow()

    expect(() => assertPreviousCompatible(ROOT)).not.toThrow()
  }, 120_000)
})
