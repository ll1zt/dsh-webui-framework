import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { compareHostRows, hostRowIds } from './host-compat.ts'
import type { HostCompatFile } from './host-compat.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'scripts/fixtures/host-compat')
const CLI = join(ROOT, 'scripts/host-compat.ts')

const read = (path: string): string => readFileSync(path, 'utf8')

const file = (kept: string[], knownMissing: Record<string, string> = {}): HostCompatFile => ({
  hostPackage: '@deepseek-ai/dsh-web-app',
  kept,
  knownMissing,
})

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

const runCli = (cwd: string): Promise<CliResult> =>
  new Promise((resolve) => {
    execFile(process.execPath, [CLI], { cwd }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
      resolve({ code, stdout, stderr })
    })
  })

describe('hostRowIds', () => {
  it('A1 lists ids of insert rows (nested too) in order, once, skipping top-level overrides', () => {
    const ids = hostRowIds(read(join(FIXTURES, 'table.patch.yml')))
    expect(ids).toEqual(['alpha', 'beta', 'gamma', 'delta', 'epsilon'])
  })
})

describe('compareHostRows', () => {
  it('A2 puts a disabled id the host lacks into missing unless it is known missing', () => {
    const report = compareHostRows(['a', 'b'], ['a', 'gone-2', 'b', 'gone-1', 'old'], file([], { old: 'since 0.2.2' }))
    expect(report.missing).toEqual(['gone-2', 'gone-1'])
    expect(report.unlisted).toEqual([])
  })

  it('A2 puts a host row neither disabled nor kept into unlisted, in host order', () => {
    const report = compareHostRows(['new-2', 'a', 'kept', 'new-1'], ['a'], file(['kept', 'kept-but-absent']))
    expect(report.unlisted).toEqual(['new-2', 'new-1'])
    expect(report.missing).toEqual([])
  })

  it('A2 reports nothing when disabled, kept and known-missing ids account for every row', () => {
    const report = compareHostRows(['a', 'b', 'k'], ['a', 'b', 'old'], file(['k'], { old: 'since 0.2.2' }))
    expect(report).toEqual({ missing: [], unlisted: [] })
  })
})

describe('installed @deepseek-ai/dsh-web-app', () => {
  it('A3 matches the ids this repo disables and the ones scripts/host-compat.json keeps', () => {
    const hostRows = hostRowIds(read(join(ROOT, 'node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml')))
    const patch = parse(read(join(ROOT, 'cordis.patch.yml'))) as { id?: string; disabled?: boolean }[]
    const disabled = patch.filter((entry) => entry.disabled === true).map((entry) => entry.id as string)
    const compat = JSON.parse(read(join(ROOT, 'scripts/host-compat.json'))) as HostCompatFile

    expect(hostRows.length).toBeGreaterThan(0)
    expect(disabled).toHaveLength(47)
    expect(compareHostRows(hostRows, disabled, compat)).toEqual({ missing: [], unlisted: [] })
  })
})

describe('host-compat CLI', () => {
  it('A4 exits 0 when the installed table matches', async () => {
    const result = await runCli(join(FIXTURES, 'ok'))
    expect(result.code).toBe(0)
  })

  it('A4 exits 1 and prints every problem id when the table differs', async () => {
    const result = await runCli(join(FIXTURES, 'mismatch'))
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('row-renamed-away')
    expect(result.stdout).toContain('row-brand-new')
  })

  it('A4 exits 2 when the host package is not installed', async () => {
    const result = await runCli(join(FIXTURES, 'absent'))
    expect(result.code).toBe(2)
  })
})
