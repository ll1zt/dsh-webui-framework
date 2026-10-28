import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { gzipSync } from 'node:zlib'
import ts from 'typescript'
import { PLUGIN_ID, isSeedModule } from './plugin-constants.ts'

/** 1.5 MiB of gzipped client code is what the shell's boot budget allows (03 §1.5). */
const DEFAULT_BUDGET_BYTES = 1_572_864

export type BundleViolationCode =
  | 'parse-error'
  | 'top-level-module-syntax'
  | 'import-meta'
  | 'foreign-require'
  | 'load-count'
  | 'wrong-id'
  | 'chunk-field'
  | 'no-apply'
  | 'size-budget'

export interface BundleViolation {
  code: BundleViolationCode
  detail: string
}

export interface BundleReport {
  id: string | undefined
  gzipBytes: number
  externalRequires: string[]
  violations: BundleViolation[]
}

/** One `window.__ModuleLoader__.load` argument, as written by the build. */
interface LoaderRecord {
  id?: unknown
  factory?: unknown
  chunk?: unknown
}

/** One injected stylesheet tag as the CSS modules of the bundle create it. */
interface StyleTag {
  dataset: Record<string, string>
  textContent: string
}

/** Raised by the stub `require` for a specifier the loader cannot answer. */
class ForeignRequireError extends Error {
  readonly specifier: string

  constructor(specifier: string) {
    super(`the bundle requires "${specifier}", which is not a seed module the loader answers`)
    this.name = 'ForeignRequireError'
    this.specifier = specifier
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Parse `source` the way a classic script is parsed: a CommonJS-wrapped bundle
 * is not a module, so module syntax is a violation rather than an input form.
 */
function parse(source: string): ts.SourceFile {
  return ts.createSourceFile('client.js', source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node)
  node.forEachChild((child) => {
    walk(child, visit)
  })
}

/** TypeScript keeps parse diagnostics off the public type, but they are the only syntax-error report it gives. */
function parseDiagnostics(file: ts.SourceFile): readonly ts.Diagnostic[] {
  return (file as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
}

/** Whether a statement only exists in a module: `import`, `export`, or an export modifier. */
function isModuleStatement(statement: ts.Statement): boolean {
  if (
    ts.isImportDeclaration(statement) ||
    ts.isExportDeclaration(statement) ||
    ts.isExportAssignment(statement) ||
    ts.isImportEqualsDeclaration(statement)
  ) {
    return true
  }
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : []
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

/** The specifier of a `require("…")` call, when `node` is one. */
function requiredSpecifier(node: ts.Node): string | undefined {
  if (!ts.isCallExpression(node)) return undefined
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') return undefined
  const [first] = node.arguments
  return first !== undefined && ts.isStringLiteralLike(first) ? first.text : undefined
}

/** Static half of the contract: everything a byte scan and a parse can decide. */
function analyze(source: string): { violations: BundleViolation[]; requires: string[] } {
  const violations: BundleViolation[] = []
  const requires = new Set<string>()
  const file = parse(source)

  for (const diagnostic of parseDiagnostics(file)) {
    violations.push({ code: 'parse-error', detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ') })
  }
  for (const statement of file.statements) {
    if (!isModuleStatement(statement)) continue
    violations.push({
      code: 'top-level-module-syntax',
      detail: `the bundle body must be one classic-script loader call, found: ${statement.getText(file).slice(0, 60)}`,
    })
  }
  walk(file, (node) => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      violations.push({ code: 'import-meta', detail: 'import.meta is unavailable to a classic script' })
    }
    const specifier = requiredSpecifier(node)
    if (specifier === undefined) return
    requires.add(specifier)
    if (!isSeedModule(specifier)) {
      violations.push({ code: 'foreign-require', detail: `require("${specifier}") is not a seed module` })
    }
  })
  return { violations, requires: [...requires].sort() }
}

/**
 * Check a bundle source against the loader contract without touching the disk.
 * The parse is the script-shaped one the browser applies, so a bundle that
 * carries module syntax is reported rather than silently accepted.
 */
export function checkBundleSource(source: string): BundleViolation[] {
  return analyze(source).violations
}

/**
 * Stand in for the browser document while the factory runs: the bundle's
 * stylesheet modules must be able to install a tag once and find it afterwards.
 */
function createDocument(tags: Map<string, StyleTag>): Record<string, unknown> {
  return {
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: (selector: string) => {
      for (const [key, tag] of tags) if (selector.includes(key)) return tag
      return null
    },
    head: {
      appendChild: (tag: StyleTag) => {
        const key = tag.dataset.pluginCss
        if (key !== undefined) tags.set(key, tag)
        return tag
      },
    },
  }
}

/** A `require` the loader could answer: deep enough for any property and call the seed modules use. */
function createSeedRequire(requested: Set<string>): unknown {
  const seeded: unknown = new Proxy(function seededModule() {}, {
    get: (_target, property) => (property === 'then' ? undefined : seeded),
    apply: (_target, _thisArg, args: unknown[]) => {
      const [specifier] = args
      if (typeof specifier !== 'string') return seeded
      requested.add(specifier)
      if (!isSeedModule(specifier)) throw new ForeignRequireError(specifier)
      return seeded
    },
  })
  return seeded
}

/**
 * Verify a built `lib/` directory against the loader contract: one load call
 * with the plugin id and no chunk field, a factory whose exports carry `apply`,
 * no syntax the browser cannot run, only seed modules required, and a gzipped
 * size inside the boot budget.
 * @param libDir - directory holding the built `client.js`.
 * @param options - `budgetBytes` overrides the gzip budget for the check.
 * @returns the report; violations are listed rather than thrown.
 * @throws {Error} when `libDir` holds no readable `client.js`.
 */
export async function verifyBundle(
  libDir: string,
  options: { budgetBytes?: number } = {},
): Promise<BundleReport> {
  const bundleFile = join(resolve(libDir), 'client.js')
  const source = await readFile(bundleFile, 'utf8').catch(() => {
    throw new Error(`verify-bundle: cannot read the client bundle at ${bundleFile}`)
  })
  const { violations, requires } = analyze(source)
  const gzipBytes = gzipSync(source).length
  const budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES
  if (gzipBytes > budgetBytes) {
    violations.push({ code: 'size-budget', detail: `${gzipBytes} gzip bytes exceed the ${budgetBytes} byte budget` })
  }

  const loads: LoaderRecord[] = []
  const requested = new Set<string>()
  const context: Record<string, unknown> = {
    window: { __ModuleLoader__: { load: (record: LoaderRecord) => { loads.push(record) } } },
    document: createDocument(new Map()),
  }
  try {
    runInNewContext(source, context)
  } catch (error) {
    if (!violations.some((violation) => violation.code === 'parse-error')) {
      violations.push({ code: 'parse-error', detail: messageOf(error) })
    }
  }

  if (loads.length !== 1) {
    violations.push({ code: 'load-count', detail: `window.__ModuleLoader__.load ran ${loads.length} times, expected once` })
  }
  const record = loads[0]
  const id = typeof record?.id === 'string' ? record.id : undefined
  if (record === undefined) return { id, gzipBytes, externalRequires: [...requires], violations }

  if (record.id !== PLUGIN_ID) {
    violations.push({ code: 'wrong-id', detail: `the loader record declares ${JSON.stringify(record.id)} instead of "${PLUGIN_ID}"` })
  }
  if ('chunk' in record) {
    violations.push({ code: 'chunk-field', detail: 'the entry bundle must not declare a chunk name' })
  }
  if (typeof record.factory !== 'function') {
    violations.push({ code: 'no-apply', detail: 'the loader record carries no factory' })
    return { id, gzipBytes, externalRequires: [...requires], violations }
  }

  try {
    const exported = record.factory(createSeedRequire(requested))
    const apply = (exported as { apply?: unknown } | undefined)?.apply
    if (typeof apply !== 'function') {
      violations.push({ code: 'no-apply', detail: 'the factory exports no apply function' })
    }
  } catch (error) {
    // A seed gap surfaces only when the factory runs, and it must be reported
    // rather than allowed to abort the whole check.
    if (error instanceof ForeignRequireError) {
      if (!violations.some((violation) => violation.code === 'foreign-require' && violation.detail.includes(error.specifier))) {
        violations.push({ code: 'foreign-require', detail: messageOf(error) })
      }
    } else {
      violations.push({ code: 'no-apply', detail: `the factory threw before exporting apply: ${messageOf(error)}` })
    }
  }

  return {
    id,
    gzipBytes,
    externalRequires: [...new Set([...requires, ...requested])].sort(),
    violations,
  }
}

/** Human-readable report for the CLI, one line per fact the contract pins. */
function renderReport(libDir: string, report: BundleReport): string {
  const external = report.externalRequires.length === 0 ? '(none)' : report.externalRequires.join(', ')
  return [
    `verify-bundle: ${libDir}`,
    `  id: ${report.id ?? '(none)'}`,
    `  gzip bytes: ${report.gzipBytes}`,
    `  external requires: ${external}`,
    report.violations.length === 0 ? '  violations: none' : '  violations:',
    ...report.violations.map((violation) => `    - ${violation.code}: ${violation.detail}`),
  ].join('\n')
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedAsScript) {
  const libDir = process.argv[2] ?? 'lib'
  try {
    const report = await verifyBundle(libDir)
    console.log(renderReport(libDir, report))
    process.exitCode = report.violations.length === 0 ? 0 : 1
  } catch (error) {
    console.error(`verify-bundle: ${messageOf(error)}`)
    process.exitCode = 1
  }
}
