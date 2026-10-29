import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const STRICT_FLAGS = [
  'strict',
  'noUncheckedIndexedAccess',
  'exactOptionalPropertyTypes',
  'verbatimModuleSyntax',
] as const

/** Effective program of a tsconfig: root-relative forward-slash file names plus the resolved options. */
const parse = (name: string): { files: string[]; options: ts.CompilerOptions } => {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    resolve(ROOT, name),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      },
    },
  )
  if (!parsed) throw new Error(`cannot parse ${name}`)
  const files = parsed.fileNames.map((file) => relative(ROOT, file).split('\\').join('/'))
  return { files, options: parsed.options }
}

describe('tsconfig split', () => {
  it('A1 tsconfig.json covers only non-test src code without node types', () => {
    const { files, options } = parse('tsconfig.json')
    expect(files).toContain('src/client/index.ts')
    expect(files.filter((file) => /\.test\.tsx?$/.test(file))).toEqual([])
    expect(files.filter((file) => file.startsWith('src/test/'))).toEqual([])
    expect(files.filter((file) => file.startsWith('scripts/'))).toEqual([])
    expect(options.types).toEqual([])
  })

  it('A2 tsconfig.node.json covers scripts, root configs, src tests and node types', () => {
    const { files, options } = parse('tsconfig.node.json')
    expect(files).toEqual(
      expect.arrayContaining([
        'scripts/host-smoke.ts',
        'tsdown.config.ts',
        'vitest.config.ts',
        'src/client/index.test.ts',
        'src/test/fake-ctx.ts',
      ]),
    )
    expect(options.types).toContain('node')
  })

  it('A3 both configs keep the strictness flags on', () => {
    for (const name of ['tsconfig.json', 'tsconfig.node.json']) {
      const { options } = parse(name)
      for (const flag of STRICT_FLAGS) expect(options[flag], `${name} ${flag}`).toBe(true)
    }
  })

  it('A4 the typecheck script runs tsc --noEmit for both configs in order', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    const commands = (pkg.scripts['typecheck'] ?? '').split('&&').map((part) => part.trim())
    expect(commands).toHaveLength(2)
    for (const command of commands) expect(command).toMatch(/^tsc\b.*--noEmit\b/)
    expect(commands[0]).toMatch(/-p tsconfig\.json(\s|$)/)
    expect(commands[1]).toMatch(/-p tsconfig\.node\.json(\s|$)/)
  })
})
