import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPageStore } from './page-store.ts'

const SIDEBAR_WIDTH_KEY = 'dsh-web-ui:sidebar-width'

interface PackageJson {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readText(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

/** Stub localStorage with a single-key store whose reads go through `read`. */
function stubStorage(read: (key: string) => string | null): void {
  vi.stubGlobal('localStorage', { getItem: read })
}

function initialState() {
  return createPageStore().create().getSnapshot()
}

describe('store engine', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('A1 zustand/vanilla and immer resolve for the real store engine', async () => {
    await expect(import('zustand/vanilla')).resolves.toBeDefined()
    await expect(import('immer')).resolves.toBeDefined()

    const pkg = JSON.parse(readText('../../../package.json')) as PackageJson
    expect(pkg.devDependencies?.zustand).toBe('~4.5.7')
    expect(pkg.devDependencies?.immer).toBe('^10.1.1')
    expect(pkg.dependencies?.zustand).toBeUndefined()
    expect(pkg.dependencies?.immer).toBeUndefined()
  })

  it('A2 createPageStore runs on the real engine and seeds the initial PageState', () => {
    stubStorage((key) => (key === SIDEBAR_WIDTH_KEY ? '300' : null))
    expect(initialState()).toEqual({
      sidebarWidth: 300,
      filesHeight: 240,
      rightPanelOpen: false,
      settingsOpen: false,
      settingsSection: 'general',
    })

    const fallback = {
      sidebarWidth: 260,
      filesHeight: 240,
      rightPanelOpen: false,
      settingsOpen: false,
      settingsSection: 'general',
    }
    stubStorage(() => null)
    expect(initialState()).toEqual(fallback)
    stubStorage(() => 'abc')
    expect(initialState()).toEqual(fallback)
    stubStorage(() => {
      throw new Error('storage is denied')
    })
    expect(initialState()).toEqual(fallback)
  })

  it('A3 neither test file mocks the store engine', () => {
    for (const file of ['../index.test.ts', './page-store.test.ts']) {
      expect(readText(file)).not.toContain("vi.mock('@deepseek-ai/dsh-client-store'")
    }
  })
})
