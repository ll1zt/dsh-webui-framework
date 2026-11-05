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
const ARGUMENT_NOT_ASSIGNABLE = 2345

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

/** Types a session-block plugin declares with `import type` from the contract, and nothing else. */
const sessionContract = [
  `import type { ComponentType } from 'react'`,
  `import type {`,
  `  BlockComponentOf,`,
  `  BlockInstanceProps,`,
  `  RootBlockMeta,`,
  `  SessionBlockMeta,`,
  `  SessionBlockProps,`,
  `  WebuiSession,`,
  `  WebuiSessionState,`,
  `} from '${CONTRACT}'`,
  `const cold: WebuiSessionState = {`,
  `  sessionId: 's', running: false, blank: true, removed: false, openState: 'cold', lastAgentError: null,`,
  `}`,
  `const loading: WebuiSessionState = {`,
  `  sessionId: 's', running: false, blank: true, removed: false, openState: 'loading', lastAgentError: null,`,
  `}`,
  `const opened: WebuiSessionState = {`,
  `  sessionId: 's', running: true, blank: false, removed: false, openState: 'open', lastAgentError: 'boom',`,
  `}`,
  `const failed: WebuiSessionState = {`,
  `  sessionId: 's', running: false, blank: false, removed: true, openState: 'error', lastAgentError: null,`,
  `}`,
  `declare const session: WebuiSession`,
  `const running: boolean = session.useState((state) => state.running)`,
  `const flags: boolean[] = session.useState(`,
  `  (state) => [state.running],`,
  `  (left, right) => left[0] === right[0],`,
  `)`,
  `const ok: Promise<boolean> = session.send('x')`,
  `const stopped: Promise<boolean> = session.stop()`,
  `const sessionId: string = session.sessionId`,
  `const rootMeta: RootBlockMeta = {`,
  `  id: 'root', scope: 'root', priority: 1, title: { en: 'Root' }, closable: true, multiInstance: false,`,
  `}`,
  `const sessionMeta: SessionBlockMeta = {`,
  `  id: 'session', scope: 'session', priority: 1, title: { en: 'Session' }, closable: true, multiInstance: false,`,
  `}`,
  `const sessionView: ComponentType<SessionBlockProps> = (props) => (props.session.sessionId === sessionId ? null : null)`,
  `const rootView: ComponentType<BlockInstanceProps> = () => null`,
  `const sessionComp: BlockComponentOf<SessionBlockMeta> = sessionView`,
  `const rootComp: BlockComponentOf<RootBlockMeta> = rootView`,
  `export { cold, loading, opened, failed, running, flags, ok, stopped, rootMeta, sessionMeta, sessionComp, rootComp, rootView }`,
].join('\n')

const closedOpenState = [
  `import type { WebuiSessionState } from '${CONTRACT}'`,
  `export const bad: WebuiSessionState = {`,
  `  sessionId: 's',`,
  `  running: false,`,
  `  blank: false,`,
  `  removed: false,`,
  `  openState: 'closed',`,
  `  lastAgentError: null,`,
  `}`,
].join('\n')

/** One `registerBlock` call, so a rejection belongs to this call and not to a neighbour. */
const registerCall = (meta: string, component: 'sessionView' | 'rootView'): string =>
  [
    `import type { ComponentType } from 'react'`,
    `import type { BlockInstanceProps, BlockMeta, SessionBlockProps, WebuiLayoutService } from '${CONTRACT}'`,
    `declare const layout: WebuiLayoutService`,
    `declare const meta: BlockMeta`,
    `const sessionView: ComponentType<SessionBlockProps> = (props) => (props.session.sessionId === '' ? null : null)`,
    `const rootView: ComponentType<BlockInstanceProps> = () => null`,
    `layout.registerBlock(${meta}, ${component})`,
  ].join('\n')

const blockLiteral = (scope: 'root' | 'session'): string =>
  `{ id: 'demo', scope: '${scope}', priority: 1, title: { en: 'Demo' }, closable: true, multiInstance: false }`

const SNIPPETS: Record<string, string> = {
  ok: fixture('ok.fixture.txt'),
  badScope: fixture('ok.fixture.txt').replace("scope: 'root'", "scope: 'global'"),
  valueImport: fixture('value-import.fixture.txt'),
  tokens: tokenSnippet(cssTokens()),
  sessionContract,
  closedOpenState,
  sessionOnSession: registerCall(blockLiteral('session'), 'sessionView'),
  rootOnRoot: registerCall(blockLiteral('root'), 'rootView'),
  sessionOnRoot: registerCall(blockLiteral('session'), 'rootView'),
  rootOnSession: registerCall(blockLiteral('root'), 'sessionView'),
  unionOnSession: registerCall('meta', 'sessionView'),
  unionOnRoot: registerCall('meta', 'rootView'),
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

  it('A1 a type-only snippet uses WebuiSessionState, WebuiSession, SessionBlockProps, RootBlockMeta, SessionBlockMeta and BlockComponentOf', () => {
    expect(describeAll(diagnostics.sessionContract ?? [])).toEqual([])
  }, 60_000)

  it('A1 openState closed is rejected with TS2322', () => {
    const found = diagnostics.closedOpenState ?? []
    const codes = found.map((diagnostic) => diagnostic.code)
    expect(codes).toContain(TYPE_MISMATCH)
    expect(codes).not.toContain(CANNOT_FIND_MODULE)
    expect(describeAll(found).some((message) => message.includes('"closed"'))).toBe(true)
  }, 60_000)

  it('A2 registerBlock component type follows meta scope', () => {
    for (const name of ['sessionOnSession', 'rootOnRoot', 'sessionOnRoot', 'unionOnRoot']) {
      expect(describeAll(diagnostics[name] ?? []), name).toEqual([])
    }
    for (const name of ['rootOnSession', 'unionOnSession']) {
      const codes = (diagnostics[name] ?? []).map((diagnostic) => diagnostic.code)
      expect(codes, name).not.toContain(CANNOT_FIND_MODULE)
      expect(
        codes.some((code) => code === ARGUMENT_NOT_ASSIGNABLE || code === TYPE_MISMATCH),
        name,
      ).toBe(true)
    }
  }, 60_000)
})

describe('contract module specifiers', () => {
  it('A3 the contract has no import from @deepseek-ai/* (module augmentation excluded)', () => {
    const file = join(ROOT, 'contract/index.d.ts')
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const specifiers: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier
        if (specifier !== undefined && ts.isStringLiteralLike(specifier)) specifiers.push(specifier.text)
      } else if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      ) {
        specifiers.push(node.argument.literal.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(specifiers).toContain('react')
    expect(specifiers.filter((specifier) => specifier.startsWith('@deepseek-ai/'))).toEqual([])
  })
})
