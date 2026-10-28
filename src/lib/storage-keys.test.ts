import { describe, expect, it } from 'vitest'
import type { StorageKey } from './storage-keys.ts'
import { STORAGE_KEYS, STORAGE_PREFIX } from './storage-keys.ts'

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
})
