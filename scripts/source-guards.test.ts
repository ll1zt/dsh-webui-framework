import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SEED_MODULES } from './plugin-constants.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Every .ts/.tsx under dir, skipping tests. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sources(path))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const files = sources(join(ROOT, 'src'))
const NODE_ENTRY = join(ROOT, 'src', 'index.ts')
/** The browser half: every source file except the Node entry. */
const browserFiles = files.filter((file) => file !== NODE_ENTRY)

/**
 * A value import of an @deepseek-ai module: `import x from '…'`, `import { a } from '…'`
 * (a bare `type` modifier on the clause is excluded), and `require('…')`.
 */
const VALUE_IMPORT = /(?:import\s+(?!type\b)[^'"]*?\sfrom\s*|require\(\s*)['"](@deepseek-ai\/[^'"]+)['"]/g

describe('src value imports of host packages', () => {
  it('A1 a value import in the browser half names a platform seed exactly, never a subpath or another package', () => {
    const offenders: string[] = []
    for (const file of browserFiles) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(VALUE_IMPORT)) {
        const specifier = match[1] ?? ''
        if (!SEED_MODULES.includes(specifier)) offenders.push(`${file.slice(ROOT.length + 1)}: ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('Node half value imports', () => {
  /** Every module the Node entry imports for its value: `import x from`, side-effect `import '…'` and `require`. */
  const ANY_VALUE_IMPORT = /(?:import\s+(?!type\b)(?:[^'"]*?\sfrom\s*)?|require\(\s*)['"]([^'"]+)['"]/g

  it('A1 the Node half value-imports only @deepseek-ai/schemastery', () => {
    const text = readFileSync(NODE_ENTRY, 'utf8')
    const specifiers = [...text.matchAll(ANY_VALUE_IMPORT)].map((match) => match[1])
    expect(specifiers.filter((specifier) => specifier !== '@deepseek-ai/schemastery')).toEqual([])
  })
})

describe('log prefix single exit', () => {
  const module = 'src/client/services/log-prefix.ts'
  const text = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

  it('A6 the [webui-framework] literal is spelled only in the log-prefix module, and [dsh-web-ui] nowhere', () => {
    const offenders = files.filter(
      (file) => file !== join(ROOT, module) && readFileSync(file, 'utf8').includes('[webui-framework]'),
    )
    expect(offenders).toEqual([])
    expect(text(module)).toContain('[webui-framework]')
    // split so this file does not itself match the search
    const oldPrefix = '[dsh-' + 'web-ui]'
    expect(files.filter((file) => readFileSync(file, 'utf8').includes(oldPrefix))).toEqual([])
  })

  it('A6 the error boundary and the block registry import LOG_PREFIX from it and define no prefix of their own', () => {
    for (const path of ['src/ui/shell/ErrorBoundary.tsx', 'src/client/services/block-registry.ts']) {
      expect(text(path)).toMatch(/import\s*\{[^}]*\bLOG_PREFIX\b[^}]*\}\s*from\s*['"][^'"]*log-prefix\.ts['"]/)
    }
    const definers = files.filter(
      (file) => file !== join(ROOT, module) && /\bLOG_(?:PREFIX|LABEL)\s*=/.test(readFileSync(file, 'utf8')),
    )
    expect(definers.map((file) => file.slice(ROOT.length + 1))).toEqual([])
  })
})
