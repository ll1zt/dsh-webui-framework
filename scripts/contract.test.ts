import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(ROOT, 'scripts/fixtures/contract')
const CONTRACT = '@lllzt/dsh-webui-framework/contract'

const CANNOT_FIND_MODULE = 2307
const TYPE_ONLY_IMPORT_REQUIRED = 1484
const TYPE_USED_AS_VALUE = 2693
const TYPE_MISMATCH = 2322

const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

/** The body rule's custom properties, read the way src/styles/tokens.test.ts reads them. */
const cssTokens = (): string[] => {
  const css = readFileSync(join(ROOT, 'src/styles/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const body = /^\s*body\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
  return [...body.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1] ?? '')
}

const tokenSnippet = (tokens: readonly string[]): string => {
  const literals = tokens.map((token) => `'${token}'`)
  return [
    `import type { WebuiTokenName } from '${CONTRACT}'`,
    `export const all: Record<WebuiTokenName, true> = { ${literals.map((literal) => `${literal}: true`).join(', ')} }`,
    `type Extra = Exclude<WebuiTokenName, ${literals.join(' | ')}>`,
    `export const none: [Extra] extends [never] ? true : false = true`,
  ].join('\n')
}

const SNIPPETS: Record<string, string> = {
  ok: fixture('ok.fixture.txt'),
  badScope: fixture('ok.fixture.txt').replace("scope: 'root'", "scope: 'global'"),
  valueImport: fixture('value-import.fixture.txt'),
  tokens: tokenSnippet(cssTokens()),
}

/** Compile every snippet as a virtual file inside the repo, so the package self-reference resolves. */
const compile = (snippets: Record<string, string>): Record<string, ts.Diagnostic[]> => {
  const config = ts.readConfigFile(join(ROOT, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT)
  const virtual = new Map(
    Object.entries(snippets).map(([name, text]) => [join(FIXTURES, '__virtual__', `${name}.ts`), text] as const),
  )
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (file) => virtual.has(file) || fileExists(file)
  host.readFile = (file) => virtual.get(file) ?? readFile(file)
  host.getSourceFile = (file, languageVersion, ...rest) => {
    const text = virtual.get(file)
    return text === undefined
      ? getSourceFile(file, languageVersion, ...rest)
      : ts.createSourceFile(file, text, languageVersion)
  }
  const program = ts.createProgram([...virtual.keys()], options, host)
  return Object.fromEntries(
    [...virtual].map(([file, _text]) => {
      const source = program.getSourceFile(file)
      return [
        file.slice(file.lastIndexOf('/') + 1, -'.ts'.length),
        source === undefined
          ? []
          : [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)],
      ]
    }),
  )
}

const describeAll = (diagnostics: readonly ts.Diagnostic[]): string[] =>
  diagnostics.map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)

describe('type-only contract', () => {
  let diagnostics: Record<string, ts.Diagnostic[]> = {}

  beforeAll(() => {
    diagnostics = compile(SNIPPETS)
  }, 60_000)

  it('A1 a snippet that only imports types compiles and registers a block through ctx.webuiLayout', () => {
    expect(describeAll(diagnostics.ok ?? [])).toEqual([])
    // the contract is typed, not loose: a scope outside root|session is a type error, not a missing module
    const codes = (diagnostics.badScope ?? []).map((d) => d.code)
    expect(codes).toContain(TYPE_MISMATCH)
    expect(codes).not.toContain(CANNOT_FIND_MODULE)
  }, 60_000)

  it('A2 a value import of the contract fails to compile because the contract holds only types', () => {
    const codes = (diagnostics.valueImport ?? []).map((d) => d.code)
    expect(codes).not.toContain(CANNOT_FIND_MODULE)
    expect(codes).toContain(TYPE_ONLY_IMPORT_REQUIRED)
    expect(codes).toContain(TYPE_USED_AS_VALUE)
  }, 60_000)

  it('A3 WebuiTokenName has exactly the custom properties the tokens.css body defines', () => {
    expect(cssTokens()).toHaveLength(15)
    expect(describeAll(diagnostics.tokens ?? [])).toEqual([])
  }, 60_000)
})
