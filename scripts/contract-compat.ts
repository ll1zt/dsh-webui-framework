import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** One previous-contract fixture that no longer compiles, and a short diagnostic summary. */
export interface CompatFailure {
  fixture: string
  message: string
}

/**
 * Package root that holds this module. Compiler options and module resolution always come from here,
 * even when `compilePreviousFixtures` is asked to read fixtures out of a copy that has no tsconfig and no node_modules.
 */
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const PREVIOUS = join('scripts', 'fixtures', 'contract', 'previous')
const FIXTURE_SUFFIX = '.fixture.txt'
/** A failing fixture's summary quotes at most this many diagnostics, the first few in source order. */
const SUMMARY_LIMIT = 5

/** `*.fixture.txt` under `scripts/fixtures/contract/previous`, relative to `root`, in code-unit order. */
function listFixtures(root: string): string[] {
  const dir = join(root, PREVIOUS)
  if (!existsSync(dir)) return []
  const found: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith(FIXTURE_SUFFIX)) found.push(relative(root, path))
    }
  }
  walk(dir)
  found.sort()
  return found
}

/** `TS<code>: message` for the first few diagnostics, in source order. */
function summarize(diagnostics: readonly ts.Diagnostic[]): string {
  return [...diagnostics]
    .sort((left, right) => (left.start ?? 0) - (right.start ?? 0) || left.code - right.code)
    .slice(0, SUMMARY_LIMIT)
    .map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
    .join('\n')
}

/**
 * Compile every previous-contract usage fixture under `root` (scripts/fixtures/contract/previous, `*.fixture.txt`)
 * as a virtual `.ts` file. The virtual files sit inside this repo and the compiler options are this repo's tsconfig,
 * the same arrangement as `scripts/contract.test.ts`, so the package's contract entry resolves to this repo's
 * `contract/index.d.ts` even when `root` is only a copy of the fixtures.
 * @param root - directory whose `scripts/fixtures/contract/previous` holds the fixtures. It need not be this repo.
 * @returns one summary per fixture that fails, in path order. Empty when every fixture typechecks.
 */
export function compilePreviousFixtures(root: string): CompatFailure[] {
  const base = resolve(root)
  const fixtures = listFixtures(base)
  if (fixtures.length === 0) return []

  const config = ts.readConfigFile(join(REPO, 'tsconfig.json'), ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, REPO)
  const virtual = new Map<string, { text: string; fixture: string }>()
  for (const fixture of fixtures) {
    const text = readFileSync(join(base, fixture), 'utf8')
    const virtualName = fixture.replaceAll('/', '__').replaceAll('\\', '__')
    virtual.set(join(REPO, 'scripts/fixtures/contract/__virtual_compat__', `${virtualName}.ts`), { text, fixture })
  }

  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (file) => virtual.has(file) || fileExists(file)
  host.readFile = (file) => virtual.get(file)?.text ?? readFile(file)
  host.getSourceFile = (file, languageVersion, ...rest) => {
    const text = virtual.get(file)?.text
    return text === undefined
      ? getSourceFile(file, languageVersion, ...rest)
      : ts.createSourceFile(file, text, languageVersion)
  }

  const program = ts.createProgram([...virtual.keys()], options, host)
  const failures: CompatFailure[] = []
  for (const [file, entry] of virtual) {
    const source = program.getSourceFile(file)
    if (source === undefined) {
      failures.push({ fixture: entry.fixture, message: 'TS0: fixture was not part of the program' })
      continue
    }
    const diagnostics = [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]
    if (diagnostics.length === 0) continue
    failures.push({ fixture: entry.fixture, message: summarize(diagnostics) })
  }
  return failures
}
