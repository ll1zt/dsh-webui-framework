import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { checkBundleSource, verifyBundle } from './verify-bundle.ts'
import type { BundleViolation } from './verify-bundle.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_ID = '@lllzt/dsh-webui-framework'
const SEED = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const BANNER = `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}", factory: (require) => {`
const FOOTER = 'return module.exports; } });'

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')
const codes = (violations: BundleViolation[]): string[] => violations.map((violation) => violation.code)

const runBuild = (): void => {
  try {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, timeout: 240_000, encoding: 'utf8', stdio: 'pipe' })
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string; message?: string }
    throw new Error(
      `npm run build failed (status ${String(failure.status)}).\n` +
        `${failure.stdout ?? ''}\n${failure.stderr ?? ''}\n${failure.message ?? ''}`,
      { cause: error },
    )
  }
}

let buildOnce: Promise<void> | undefined
const ensureBuilt = (): Promise<void> => {
  buildOnce ??= Promise.resolve().then(runBuild)
  return buildOnce
}

const declarationsOf = (css: string): string[] =>
  [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)].map((match) => match[0].replace(/\s+/g, ''))

const runCli = (libDir: string) =>
  spawnSync(process.execPath, ['scripts/verify-bundle.ts', libDir], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  })

describe('built bundles', () => {
  beforeAll(async () => {
    await ensureBuilt()
  }, 240_000)

  it('A1 client bundle is one loader call with banner and footer', () => {
    expect(existsSync(join(ROOT, 'lib/client.js'))).toBe(true)
    const source = read('lib/client.js')
    expect(source.slice(0, BANNER.length)).toBe(BANNER)
    const trimmed = source.trimEnd()
    expect(trimmed.slice(-FOOTER.length)).toBe(FOOTER)
  })

  it('A1 node half exports apply after import', async () => {
    expect(existsSync(join(ROOT, 'lib/index.js'))).toBe(true)
    const nodeHalf = (await import(pathToFileURL(join(ROOT, 'lib/index.js')).href)) as { apply?: unknown }
    expect(typeof nodeHalf.apply).toBe('function')
  })

  it('A2 built bundle passes the offline contract', async () => {
    const report = await verifyBundle(join(ROOT, 'lib'))
    expect(report.violations).toEqual([])
    expect(report.id).toBe(PLUGIN_ID)
    expect(report.gzipBytes).toBeGreaterThan(0)
    expect(report.externalRequires.filter((specifier: string) => !SEED.includes(specifier))).toEqual([])
  })

  it('A4 inlined css is injected once into the document', () => {
    const bundle = read('lib/client.js')
    const cssFiles = readdirSync(join(ROOT, 'src/styles')).filter((file) => file.endsWith('.css'))
    expect(cssFiles.length).toBeGreaterThan(0)
    const minified = bundle.replace(/\s+/g, '')
    const fromSources = cssFiles.flatMap((file) => declarationsOf(read(`src/styles/${file}`)))
    expect(fromSources.length).toBeGreaterThan(0)
    expect(fromSources.filter((declaration) => minified.includes(declaration))).not.toHaveLength(0)

    const win = new Window()
    const loads: { id?: string; factory: (require: unknown) => unknown }[] = []
    ;(win as unknown as { __ModuleLoader__: unknown }).__ModuleLoader__ = {
      load: (record: { id?: string; factory: (require: unknown) => unknown }) => {
        loads.push(record)
      },
    }
    const seededRequire: unknown = new Proxy(function seeded() {} as unknown as object, {
      get: () => seededRequire,
      apply: () => seededRequire,
    })
    const evaluate = (): void => {
      const run = new Function('window', 'document', bundle) as (w: unknown, d: unknown) => void
      run(win, win.document)
      const record = loads[loads.length - 1]
      if (!record) throw new Error('bundle did not call window.__ModuleLoader__.load')
      record.factory(seededRequire)
    }

    evaluate()
    const selector = `style[data-plugin="${PLUGIN_ID}"]`
    expect(win.document.querySelectorAll(selector).length).toBe(1)
    const style = win.document.querySelector(selector)
    expect(style?.getAttribute('data-plugin-css') ?? '').toMatch(/^@lllzt\/dsh-webui-framework\/.+\.css$/)
    const cssText = style?.textContent ?? ''
    expect(cssText.trim().length).toBeGreaterThan(0)
    expect(cssText).toContain('{')

    evaluate()
    expect(win.document.querySelectorAll(selector).length).toBe(1)
  })
})

describe('checkBundleSource', () => {
  it('A3 top level module syntax', () => {
    expect(codes(checkBundleSource('import { useState } from "react"\n'))).toContain('top-level-module-syntax')
    expect(codes(checkBundleSource('export const answer = 42\n'))).toContain('top-level-module-syntax')
  })

  it('A3 import meta', () => {
    expect(codes(checkBundleSource('var meta = import.meta;\n'))).toContain('import-meta')
  })

  it('A3 foreign require', () => {
    const source = 'var session = require("@deepseek-ai/dsh-client-ui-session");\n'
    expect(codes(checkBundleSource(source))).toContain('foreign-require')
  })

  it('A3 parse error', () => {
    expect(codes(checkBundleSource('var broken = ;\n'))).toContain('parse-error')
  })
})

describe('package manifest', () => {
  interface PackageManifest {
    dsh?: { client?: { platform?: string } }
    exports?: Record<string, { default?: string }>
  }

  it('A5 declares web platform and bundle exports', () => {
    const manifest = JSON.parse(read('package.json')) as PackageManifest
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.exports?.['./client']?.default).toBe('./lib/client.js')
    expect(manifest.exports?.['.']?.default).toBe('./lib/index.js')
  })
})

describe('verify-bundle CLI and budget', () => {
  it('A6 cli exits 1 and prints the violation code', () => {
    const result = runCli('scripts/fixtures/violating')
    expect(result.status).toBe(1)
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).toContain('foreign-require')
  })

  it('A6 cli exits 0 for a conforming bundle', () => {
    const result = runCli('scripts/fixtures/valid')
    expect(`${result.stdout ?? ''}${result.stderr ?? ''}`).not.toContain('foreign-require')
    expect(result.status).toBe(0)
  })

  it('A6 reports size budget for a tiny budget', async () => {
    const report = await verifyBundle(join(ROOT, 'scripts/fixtures/valid'), { budgetBytes: 1 })
    expect(codes(report.violations)).toContain('size-budget')
  })

  it('A1 verifyBundle rejects a missing libDir instead of returning an empty report', async () => {
    await expect(verifyBundle(join(ROOT, 'scripts/fixtures/does-not-exist'))).rejects.toThrow(/does-not-exist/)
  })
})
