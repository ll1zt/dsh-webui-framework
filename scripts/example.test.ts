import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EXAMPLE = join(ROOT, 'examples/hello-block')
const FRAMEWORK = /^@lllzt\/dsh-webui-framework(\/|$)/
const REPO_SOURCE_DIRS = [join(ROOT, 'src'), join(ROOT, 'scripts')]

interface Reference {
  file: string
  specifier: string
  typeOnly: boolean
}

const isUnder = (file: string, dir: string): boolean => {
  const path = relative(dir, file)
  return !path.startsWith('..') && !isAbsolute(path)
}

/** Source and config files of the example; build output and installed packages are not authored code. */
const authoredFiles = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = join(dir, entry.name)
        if (entry.isDirectory()) return ['lib', 'node_modules'].includes(entry.name) ? [] : authoredFiles(file)
        return /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [file] : []
      })
    : []

/** Every module specifier a file imports, re-exports, `require`s or loads dynamically. */
const references = (file: string): Reference[] => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: Reference[] = []
  const add = (specifier: ts.Node | undefined, typeOnly: boolean) => {
    if (specifier !== undefined && ts.isStringLiteralLike(specifier))
      found.push({ file, specifier: specifier.text, typeOnly })
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) add(node.moduleSpecifier, node.importClause?.isTypeOnly === true)
    else if (ts.isExportDeclaration(node)) add(node.moduleSpecifier, node.isTypeOnly)
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, node.isTypeOnly)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal, true)
    else if (ts.isCallExpression(node)) {
      const callee = node.expression
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')) {
        add(node.arguments[0], false)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('hello-block example', () => {
  let program: ts.Program | undefined
  let configErrors: ts.Diagnostic[] = []
  let sourceCount = 0

  beforeAll(() => {
    const read = ts.readConfigFile(join(EXAMPLE, 'tsconfig.json'), ts.sys.readFile)
    if (read.error !== undefined) {
      configErrors = [read.error]
      return
    }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, EXAMPLE)
    configErrors = parsed.errors
    sourceCount = parsed.fileNames.length
    program = ts.createProgram(parsed.fileNames, parsed.options)
  }, 60_000)

  it('A1 type-checks against the contract with no diagnostics and pulls in no file from the repo src/', () => {
    expect(configErrors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
    expect(sourceCount).toBeGreaterThan(0)
    const diagnostics = ts.getPreEmitDiagnostics(program as ts.Program)
    expect(diagnostics.map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)).toEqual([])
    const leaked = (program as ts.Program)
      .getSourceFiles()
      .filter((file) => REPO_SOURCE_DIRS.some((dir) => isUnder(file.fileName, dir)))
    expect(leaked.map((file) => file.fileName)).toEqual([])
  }, 60_000)

  it('A1 imports the framework only with import type and registers through the contract', () => {
    const refs = authoredFiles(EXAMPLE).flatMap(references)
    const framework = refs.filter((ref) => FRAMEWORK.test(ref.specifier))
    expect(framework.map((ref) => ref.specifier)).toContain('@lllzt/dsh-webui-framework/contract')
    const valueImports = framework.filter((ref) => !ref.typeOnly)
    expect(valueImports.map((ref) => `${relative(ROOT, ref.file)}: ${ref.specifier}`)).toEqual([])
  })

  it('A1 never reaches the repo src/ through a relative, absolute or package-subpath specifier', () => {
    const files = authoredFiles(EXAMPLE)
    expect(files.length).toBeGreaterThan(0)
    const reaching = files.flatMap(references).filter(({ file, specifier }) => {
      if (/^@lllzt\/dsh-webui-framework\/(?:src|scripts)(\/|$)/.test(specifier)) return true
      if (!specifier.startsWith('.') && !isAbsolute(specifier)) return false
      const target = resolve(dirname(file), specifier)
      return REPO_SOURCE_DIRS.some((dir) => isUnder(target, dir))
    })
    expect(reaching.map((ref) => `${relative(ROOT, ref.file)}: ${ref.specifier}`)).toEqual([])
  })
})

describe('hello-block example as a profile layer', () => {
  const manifest = (): { files?: string[]; dsh?: { client?: { platform?: string }; bundle?: { patch?: string } } } =>
    JSON.parse(readFileSync(join(EXAMPLE, 'package.json'), 'utf8'))

  it('A3 declares a web client and ships a bundle patch through files', () => {
    const { files, dsh } = manifest()
    expect(dsh?.client?.platform).toBe('web')
    expect(dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(files).toContain('cordis.patch.yml')
  })

  it('A3 patch inserts exactly one row for hello-block', () => {
    const patch: unknown = parse(readFileSync(join(EXAMPLE, 'cordis.patch.yml'), 'utf8'))
    expect(patch).toEqual([{ insert: [{ id: 'hello-block', name: '@lllzt/dsh-webui-hello-block' }] }])
  })
})
