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

/**
 * A value import of an @deepseek-ai module: `import x from '…'`, `import { a } from '…'`
 * (a bare `type` modifier on the clause is excluded), and `require('…')`.
 */
const VALUE_IMPORT = /(?:import\s+(?!type\b)[^'"]*?\sfrom\s*|require\(\s*)['"](@deepseek-ai\/[^'"]+)['"]/g

describe('src value imports of host packages', () => {
  it('A1 a value import names a platform seed exactly, never a subpath or another package', () => {
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(VALUE_IMPORT)) {
        const specifier = match[1] ?? ''
        if (!SEED_MODULES.includes(specifier)) offenders.push(`${file.slice(ROOT.length + 1)}: ${specifier}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('log prefix single exit', () => {
  it('A3 the [webui-framework] literal appears only in the error boundary, and [dsh-web-ui] nowhere', () => {
    const allowed = 'src/ui/shell/ErrorBoundary.tsx'
    const offenders = files.filter(
      (file) => file !== join(ROOT, allowed) && readFileSync(file, 'utf8').includes('[webui-framework]'),
    )
    expect(offenders).toEqual([])
    expect(readFileSync(join(ROOT, allowed), 'utf8')).toContain('[webui-framework]')
    // split so this file does not itself match the search
    const oldPrefix = '[dsh-' + 'web-ui]'
    expect(files.filter((file) => readFileSync(file, 'utf8').includes(oldPrefix))).toEqual([])
  })
})
