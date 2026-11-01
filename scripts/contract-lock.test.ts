import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { checkContractLock } from './contract-lock.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'scripts/contract-lock.ts')

const INPUTS = ['package.json', 'CHANGELOG.md', 'contract/index.d.ts', 'contract/lock.json'] as const

const read = (path: string): string => readFileSync(path, 'utf8')

/** The lock hash rule: sha256 hex of the contract with CRLF normalised to LF. */
const contractHash = (root: string): string =>
  createHash('sha256')
    .update(read(join(root, 'contract/index.d.ts')).replace(/\r\n/g, '\n'))
    .digest('hex')

const copies: string[] = []

/** A fresh directory holding copies of the four inputs of the lock check. */
const makeCopy = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'contract-lock-'))
  copies.push(dir)
  for (const input of INPUTS) {
    mkdirSync(dirname(join(dir, input)), { recursive: true })
    copyFileSync(join(ROOT, input), join(dir, input))
  }
  return dir
}

const edit = (dir: string, input: (typeof INPUTS)[number], change: (text: string) => string): void => {
  const path = join(dir, input)
  writeFileSync(path, change(read(path)))
}

const setVersion = (dir: string, version: string): void =>
  edit(dir, 'package.json', (text) => text.replace(/"version": "[^"]*"/, `"version": "${version}"`))

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

const runCli = (cwd: string, args: string[] = []): Promise<CliResult> =>
  new Promise((done) => {
    execFile(process.execPath, [CLI, ...args], { cwd }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
      done({ code, stdout, stderr })
    })
  })

afterEach(() => {
  while (copies.length > 0) {
    const dir = copies.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

describe('checkContractLock on the repository', () => {
  it('A1 A10 returns no problem: lock, package.json and CHANGELOG.md agree on 0.2.0 and the contract hash', () => {
    expect(checkContractLock(ROOT)).toEqual([])

    const manifest = JSON.parse(read(join(ROOT, 'package.json'))) as { version: string }
    expect(manifest.version).toBe('0.2.0')
    expect(read(join(ROOT, 'CHANGELOG.md'))).toMatch(/^## 0\.2\.0\b/m)
    expect(JSON.parse(read(join(ROOT, 'contract/lock.json')))).toEqual({
      version: '0.2.0',
      sha256: contractHash(ROOT),
    })
  })
})

describe('checkContractLock on a copy', () => {
  it('A2 returns no problem for an untouched copy, also when the contract uses CRLF line ends', () => {
    const dir = makeCopy()
    expect(checkContractLock(dir)).toEqual([])

    edit(dir, 'contract/index.d.ts', (text) => text.replace(/\r?\n/g, '\r\n'))
    expect(checkContractLock(dir)).toEqual([])
  })

  it('A2 reports contract-changed when the contract differs by one byte', () => {
    const dir = makeCopy()
    edit(dir, 'contract/index.d.ts', (text) => `${text} `)
    expect(checkContractLock(dir)).toEqual(['contract-changed'])
  })

  it('A2 reports version-mismatch when package.json moves to 0.1.1 and the lock stays at 0.1.0', () => {
    const dir = makeCopy()
    setVersion(dir, '0.1.1')
    edit(dir, 'CHANGELOG.md', (text) => `${text}\n## 0.1.1\n\n- next\n`)
    expect(checkContractLock(dir)).toEqual(['version-mismatch'])
  })

  it('A2 reports changelog-missing when the CHANGELOG has no heading for the package version', () => {
    const dir = makeCopy()
    edit(dir, 'CHANGELOG.md', (text) => text.replace(/^## \d+\.\d+\.\d+.*$/gm, '## Unreleased'))
    expect(checkContractLock(dir)).toEqual(['changelog-missing'])
  })

  it('A2 reports lock-missing when contract/lock.json is gone', () => {
    const dir = makeCopy()
    rmSync(join(dir, 'contract/lock.json'))
    expect(checkContractLock(dir)).toEqual(['lock-missing'])
  })
})

describe('contract-lock CLI', () => {
  it('A3 check mode exits 0 for a clean copy and 1 naming the problem for a changed contract', async () => {
    const dir = makeCopy()
    expect((await runCli(dir)).code).toBe(0)

    edit(dir, 'contract/index.d.ts', (text) => `${text} `)
    const result = await runCli(dir)
    expect(result.code).toBe(1)
    expect(`${result.stdout}${result.stderr}`).toContain('contract-changed')
  })

  it('A3 --write refuses a changed contract under the locked version and leaves the lock alone', async () => {
    const dir = makeCopy()
    const lockBefore = read(join(dir, 'contract/lock.json'))
    edit(dir, 'contract/index.d.ts', (text) => `${text} `)

    const result = await runCli(dir, ['--write'])
    expect(result.code).toBe(1)
    expect(read(join(dir, 'contract/lock.json'))).toBe(lockBefore)
  })

  it('A3 --write refuses a bumped version whose CHANGELOG has no heading for it', async () => {
    const dir = makeCopy()
    const lockBefore = read(join(dir, 'contract/lock.json'))
    edit(dir, 'contract/index.d.ts', (text) => `${text} `)
    setVersion(dir, '0.1.1')

    const result = await runCli(dir, ['--write'])
    expect(result.code).toBe(1)
    expect(read(join(dir, 'contract/lock.json'))).toBe(lockBefore)
  })

  it('A3 --write with version 0.1.1 and a 0.1.1 CHANGELOG heading rewrites the lock to the new hash', async () => {
    const dir = makeCopy()
    edit(dir, 'contract/index.d.ts', (text) => `${text} `)
    setVersion(dir, '0.1.1')
    edit(dir, 'CHANGELOG.md', (text) => `${text}\n## 0.1.1\n\n- next\n`)

    const result = await runCli(dir, ['--write'])
    expect(result.code).toBe(0)
    expect(JSON.parse(read(join(dir, 'contract/lock.json')))).toEqual({
      version: '0.1.1',
      sha256: contractHash(dir),
    })
    expect(checkContractLock(dir)).toEqual([])
  })
})
