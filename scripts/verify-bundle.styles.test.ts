import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { styleInjectionModule } from './css-inject.ts'
import { verifyBundle } from './verify-bundle.ts'

const PLUGIN_ID = '@lllzt/dsh-webui-framework'

let libDir: string | undefined

afterEach(() => {
  if (libDir !== undefined) rmSync(libDir, { recursive: true, force: true })
  libDir = undefined
})

describe('verifyBundle document stand-in', () => {
  it('A2 accepts a loader call whose factory injects two sheets', async () => {
    const injections = [
      styleInjectionModule(PLUGIN_ID, 'src/ui/a/a.css', '.a{color:red}'),
      styleInjectionModule(PLUGIN_ID, 'src/ui/b/b.css', '.b{color:blue}'),
    ]
    const source = [
      `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}", factory: (require) => {`,
      'var module = { exports: {} }; var exports = module.exports;',
      'var react = require("react");',
      ...injections,
      'function apply() {',
      '  return react;',
      '}',
      'exports.apply = apply;',
      'return module.exports; } });',
    ].join('\n')
    libDir = mkdtempSync(join(tmpdir(), 'dsh-web-styles-'))
    writeFileSync(join(libDir, 'client.js'), source)

    const report = await verifyBundle(libDir)

    expect(report.violations).toEqual([])
  })
})
