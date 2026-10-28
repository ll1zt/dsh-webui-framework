import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { StorageKey } from './storage-keys.ts'
import { STORAGE_KEYS, STORAGE_PREFIX } from './storage-keys.ts'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 非测试的 .ts/.tsx 源文件（相对 src/），排除键模块本身 */
const sourceFiles = (): string[] =>
  readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map(p => p.split('\\').join('/'))
    .filter(p => /\.tsx?$/.test(p) && !p.includes('.test.') && p !== 'lib/storage-keys.ts')

describe('storage-keys', () => {
  it('A1 every key carries the prefix and no two keys collide', () => {
    const values = Object.values(STORAGE_KEYS)
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) expect(value.startsWith(STORAGE_PREFIX), value).toBe(true)
    expect(new Set(values).size).toBe(values.length)
  })

  it('A1 the sidebar width key is unchanged because users already store data under it', () => {
    expect(STORAGE_PREFIX).toBe('dsh-web-ui:')
    expect(STORAGE_KEYS.sidebarWidth).toBe('dsh-web-ui:sidebar-width')
  })

  it('A1 StorageKey admits exactly the declared values', () => {
    const key: StorageKey = STORAGE_KEYS.sidebarWidth
    expect(key).toBe('dsh-web-ui:sidebar-width')
  })

  it('A2 no source file other than the key module defines a dsh-web-ui: literal', () => {
    const offenders = sourceFiles().filter(file =>
      /['"`]dsh-web-ui:/.test(readFileSync(join(SRC, file), 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
