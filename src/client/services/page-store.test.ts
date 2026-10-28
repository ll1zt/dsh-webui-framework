// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPageStore } from './page-store.ts'

const SIDEBAR_WIDTH_KEY = 'dsh-web-ui:sidebar-width'

function fakeStorage(initial: Record<string, string>, readError?: Error): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear: () => { values.clear() },
    getItem: (key: string) => {
      if (readError !== undefined) throw readError
      return values.get(key) ?? null
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key) },
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

function seededSidebarWidth(): number {
  return createPageStore().create().getSnapshot().sidebarWidth
}

describe('createPageStore', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('TestStore_A7 seeds sidebarWidth from storage and falls back to 260', () => {
    vi.stubGlobal('localStorage', fakeStorage({ [SIDEBAR_WIDTH_KEY]: '300' }))
    expect(seededSidebarWidth()).toBe(300)

    vi.stubGlobal('localStorage', fakeStorage({}))
    expect(seededSidebarWidth()).toBe(260)

    vi.stubGlobal('localStorage', fakeStorage({ [SIDEBAR_WIDTH_KEY]: 'abc' }))
    expect(seededSidebarWidth()).toBe(260)

    vi.stubGlobal('localStorage', fakeStorage({ [SIDEBAR_WIDTH_KEY]: '300' }, new Error('storage is denied')))
    expect(seededSidebarWidth()).toBe(260)
  })
})
