import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { PLUGIN_ID, PLUGIN_ROW_ID, SEED_MODULES, isSeedModule } from './plugin-constants.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

interface InsertRow {
  id: string
  name: string
}
interface PatchEntry {
  insert?: InsertRow[]
}

// 独立的预期答案：有意不从被测模块派生
const EXPECTED_SEEDS = [
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

describe('plugin-constants', () => {
  it('A1 seed modules are exactly the 11 platform seeds', () => {
    expect(new Set(SEED_MODULES).size).toBe(SEED_MODULES.length)
    expect([...SEED_MODULES].sort()).toEqual([...EXPECTED_SEEDS].sort())
    for (const seed of EXPECTED_SEEDS) expect(isSeedModule(seed), seed).toBe(true)
  })

  it('A1 isSeedModule matches exactly, never by prefix', () => {
    for (const other of ['@deepseek-ai/dsh-client-ui-session', 'react-dom/server', 'react/jsx-dev-runtime', '']) {
      expect(isSeedModule(other), other).toBe(false)
    }
  })

  it('A2 the plugin id equals the package name and the patch row id equals the inserted row', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string }
    const entries = parse(read('cordis.patch.yml')) as PatchEntry[]
    const row = entries.at(-1)?.insert?.[0]
    expect(PLUGIN_ID).toBe(pkg.name)
    expect(PLUGIN_ROW_ID).toBe(row?.id)
    expect(row?.name).toBe(PLUGIN_ID)
  })
})
