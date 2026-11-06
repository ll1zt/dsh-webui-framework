import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ts from 'typescript'
import { afterEach, describe, expect, it } from 'vitest'
import type { WebuiLayoutService } from '@lllzt/dsh-webui-framework/contract'
import { BlockRegistry, WebuiLayout } from '../src/client/services/block-registry.ts'
import { checkContractLock } from './contract-lock.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLI = join(ROOT, 'scripts/contract-lock.ts')

const INPUTS = ['package.json', 'CHANGELOG.md', 'contract/index.d.ts', 'contract/lock.json'] as const
const VERSION_MODULE = 'src/lib/contract-version.ts'
const CANNOT_FIND_MODULE = 2307
const READONLY_ASSIGNMENT = 2540

const read = (path: string): string => readFileSync(path, 'utf8')

/** Body of one changelog section, from its `## <version>` heading through the line before the next heading. */
const changelogSection = (markdown: string, version: string): string | undefined => {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line === `## ${version}` || line.startsWith(`## ${version} `))
  if (start < 0) return undefined
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines.slice(start, next < 0 ? lines.length : next).join('\n')
}

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

/** Compile one virtual snippet with the repo tsconfig, the same way scripts/contract.test.ts does. */
const compileSnippet = (text: string): ts.Diagnostic[] => {
  const config = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
  const file = join(ROOT, 'scripts/fixtures/contract/__virtual__/contract-version.ts')
  const virtual = new Map([[file, text]])
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (path) => virtual.has(path) || fileExists(path)
  host.readFile = (path) => virtual.get(path) ?? readFile(path)
  host.getSourceFile = (path, languageVersion, ...rest) => {
    const sourceText = virtual.get(path)
    return sourceText === undefined
      ? getSourceFile(path, languageVersion, ...rest)
      : ts.createSourceFile(path, sourceText, languageVersion)
  }
  const program = ts.createProgram([file], options, host)
  const source = program.getSourceFile(file)
  if (source === undefined) throw new Error('the contract version snippet was not compiled')
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
}

const diagnosticLine = (diagnostic: ts.Diagnostic): number =>
  diagnostic.file !== undefined && diagnostic.start !== undefined
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line
    : -1

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
  it('A1 A4 A10 returns no problem: lock, package.json and CHANGELOG.md agree on 0.4.0 and the contract hash', () => {
    expect(checkContractLock(ROOT)).toEqual([])

    const manifest = JSON.parse(read(join(ROOT, 'package.json'))) as { version: string }
    expect(manifest.version).toBe('0.4.0')
    const lockfile = JSON.parse(read(join(ROOT, 'package-lock.json'))) as {
      version: string
      packages: { '': { version: string } }
    }
    expect(lockfile.version).toBe('0.4.0')
    expect(lockfile.packages[''].version).toBe('0.4.0')
    expect(read(join(ROOT, 'CHANGELOG.md'))).toMatch(/^## 0\.3\.1\b/m)
    expect(JSON.parse(read(join(ROOT, 'contract/lock.json')))).toEqual({
      version: '0.4.0',
      sha256: contractHash(ROOT),
    })
  })

  it('A6 package.json, package-lock.json, contract/lock.json and WEBUI_CONTRACT_VERSION are 0.4.0 and the 0.4.0 changelog says the change is incompatible', async () => {
    const manifest = JSON.parse(read(join(ROOT, 'package.json'))) as { version: string }
    expect(manifest.version).toBe('0.4.0')
    const lockfile = JSON.parse(read(join(ROOT, 'package-lock.json'))) as {
      version: string
      packages: { '': { version: string } }
    }
    expect(lockfile.version).toBe('0.4.0')
    expect(lockfile.packages[''].version).toBe('0.4.0')
    const contractLock = JSON.parse(read(join(ROOT, 'contract/lock.json'))) as { version: string }
    expect(contractLock.version).toBe('0.4.0')

    const { WEBUI_CONTRACT_VERSION } = await import('../src/lib/contract-version.ts')
    expect(WEBUI_CONTRACT_VERSION).toBe('0.4.0')
    expect(WEBUI_CONTRACT_VERSION).toBe(manifest.version)
    expect(WEBUI_CONTRACT_VERSION).toBe(contractLock.version)

    const section = changelogSection(read(join(ROOT, 'CHANGELOG.md')), '0.4.0')
    expect(section, '## 0.4.0 heading').toBeDefined()
    const body = (section ?? '').split(/\r?\n/).slice(1).join('\n').trim()
    const firstSentence = body.match(/^[\s\S]*?[.。!！]/)?.[0] ?? body
    expect(firstSentence).toMatch(/incompatible|不兼容/i)
  })
})

describe('contract version', () => {
  it('A2 ctx.webuiLayout.contractVersion is a readonly string', () => {
    const lines = [
      `import type { Context } from '@deepseek-ai/cordis'`,
      `import type { WebuiLayoutService } from '@lllzt/dsh-webui-framework/contract'`,
      `declare const ctx: Context`,
      `const version: string = ctx.webuiLayout.contractVersion`,
      `const service: WebuiLayoutService = ctx.webuiLayout`,
      `void version`,
      `void service`,
      `ctx.webuiLayout.contractVersion = '1.0.0'`,
    ]
    const assignLine = lines.findIndex((line) => line.includes(`= '1.0.0'`))
    const diagnostics = compileSnippet(lines.join('\n'))
    const describeOne = (diagnostic: ts.Diagnostic): string =>
      `L${diagnosticLine(diagnostic) + 1} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
    const elsewhere = diagnostics.filter((diagnostic) => diagnosticLine(diagnostic) !== assignLine)
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(CANNOT_FIND_MODULE)
    expect(elsewhere.map(describeOne)).toEqual([])
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(READONLY_ASSIGNMENT)
  }, 60_000)

  it('A2 ctx.webuiLayout.contractVersion equals the package version', () => {
    const ctx = new Context()
    const layout = new WebuiLayout(ctx, new BlockRegistry())
    const manifest = JSON.parse(read(join(ROOT, 'package.json'))) as { version: string }
    const service: WebuiLayoutService = ctx.webuiLayout
    expect(layout.contractVersion).toBe(manifest.version)
    expect(service.contractVersion).toBe(manifest.version)
    expect(manifest.version).toBe('0.4.0')
  })

  it('A2 WEBUI_CONTRACT_VERSION equals package.json and contract/lock.json', async () => {
    const { WEBUI_CONTRACT_VERSION } = await import('../src/lib/contract-version.ts')
    const manifest = JSON.parse(read(join(ROOT, 'package.json'))) as { version: string }
    const contractLock = JSON.parse(read(join(ROOT, 'contract/lock.json'))) as { version: string }
    expect(WEBUI_CONTRACT_VERSION).toBe('0.4.0')
    expect(WEBUI_CONTRACT_VERSION).toBe(manifest.version)
    expect(WEBUI_CONTRACT_VERSION).toBe(contractLock.version)
  })

  it('A2 reports contract-version-mismatch when the contract version module disagrees with the package version', () => {
    const dir = makeCopy()
    const versionPath = join(dir, VERSION_MODULE)
    expect(existsSync(join(ROOT, VERSION_MODULE))).toBe(true)
    mkdirSync(dirname(versionPath), { recursive: true })
    copyFileSync(join(ROOT, VERSION_MODULE), versionPath)
    const current = (JSON.parse(read(join(dir, 'package.json'))) as { version: string }).version
    const before = read(versionPath)
    expect(before).toContain(current)
    const edited = before.replaceAll(current, '9.9.9')
    expect(edited).not.toContain(current)
    writeFileSync(versionPath, edited)
    expect(checkContractLock(dir)).toEqual(['contract-version-mismatch'])
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
