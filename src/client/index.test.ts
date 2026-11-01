// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import type { ThemeDefinition, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { createFakeContext } from '../test/fake-ctx.ts'
import { App } from './entries/App.tsx'
import { apply } from './index.ts'

const LIGHT: ThemeDefinition = { id: 'light', colorScheme: 'light', tokens: { '--bg': '#ffffff', '--text': '#111111' } }
const DARK: ThemeDefinition = { id: 'dark', colorScheme: 'dark', tokens: { '--bg': '#000000', '--text': '#eeeeee' } }

/** A resolved snapshot with the light theme active unless overridden. */
function snapshot(overrides: Partial<ThemeSnapshot> = {}): ThemeSnapshot {
  return {
    preference: 'light',
    fontSizes: { text: 14, code: 11, terminal: 12 },
    fontFamilies: { text: '', code: '', terminal: '' },
    active: LIGHT,
    themes: [LIGHT, DARK],
    revision: 1,
    ...overrides,
  }
}

describe('client apply', () => {
  it('A1 registers exactly one root entry for App and clears it on dispose', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entries = ctx.slots.entries('root')
    expect(entries).toHaveLength(1)
    const entry = entries[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    expect(entry.component).toBe(App)
    expect(entry.locale).toBe('webui')
    expect(entry.options.priority).toBeUndefined()

    ctx.disposeAll()
    expect(ctx.slots.entries('root')).toHaveLength(0)
  })

  it('A5 the root registration declares the root and session block lists as children', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entry = ctx.slots.entries('root')[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    expect(entry.children).toMatchObject({
      'webui.block.root': { kind: 'list', scope: 'root' },
      'webui.block.session': { kind: 'list', scope: 'session' },
    })
    ctx.disposeAll()
  })

  it('A1 the root registration also declares shell.overlay as a root list, open to registration and injection', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entry = ctx.slots.entries('root')[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    const children = entry.children as Record<string, unknown>
    expect(Object.keys(children).sort()).toEqual(['shell.overlay', 'webui.block.root', 'webui.block.session'])
    expect(children['shell.overlay']).toEqual({ kind: 'list', scope: 'root' })
    // the fake only records slots.inject callbacks; the declaration is what lets a host run them
    expect(ctx.slots.spec('shell.overlay')).toEqual({ kind: 'list', scope: 'root' })
    ctx.slots.refuseUndeclared = true
    expect(() => ctx.slots.register({ name: 'shell.overlay' }, () => null)).not.toThrow()
    expect(() => ctx.slots.inject('shell.overlay', () => undefined)).not.toThrow()
    ctx.disposeAll()
  })

  it('A4 the root registration carries no store', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const entry = ctx.slots.entries('root')[0]
    if (entry === undefined) throw new Error('the root slot has no registration')
    expect(entry.store).toBeUndefined()
    ctx.disposeAll()
  })

  it('A2 registers the webui namespace with matching zh and en dictionaries', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)

    const registration = ctx.locale.registrations.find((entry) => entry.namespace === 'webui')
    expect(registration).toBeDefined()
    if (registration === undefined) throw new Error('the webui namespace is not registered')
    expect(Object.keys(registration.dictionaries).sort()).toEqual(['en', 'zh'])
    const zh = registration.dictionaries.zh
    const en = registration.dictionaries.en
    if (zh === undefined || en === undefined) throw new Error('the webui namespace misses a dictionary')

    const zhKeys = Object.keys(zh).sort()
    expect(zhKeys.length).toBeGreaterThan(3)
    expect(zhKeys).toEqual(Object.keys(en).sort())
    for (const dictionary of [zh, en]) {
      for (const value of Object.values(dictionary)) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('client apply theme effect', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-ds-dark-theme')
    for (const meta of document.head.querySelectorAll('meta')) meta.remove()
  })

  it('A6 apply applies ctx.theme.getTheme() immediately, before any event', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot({ preference: 'dark', active: DARK }) } })
    apply(ctx)
    expect(document.body.style.getPropertyValue('--bg')).toBe('#000000')
    expect(document.documentElement.style.colorScheme).toBe('dark')
    ctx.disposeAll()
  })

  it('A6 a theme/change event re-applies the emitted snapshot', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot() } })
    apply(ctx)
    ctx.emit('theme/change', snapshot({ preference: 'dark', active: DARK }))
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.body.style.getPropertyValue('--bg')).toBe('#000000')
    ctx.disposeAll()
  })

  it('A6 disposing the context leaves no presenter writes behind', () => {
    const ctx = createFakeContext({ theme: { getTheme: () => snapshot({ preference: 'dark', active: DARK }) } })
    apply(ctx)
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    ctx.disposeAll()
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(0)
  })
})
