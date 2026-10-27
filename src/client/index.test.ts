import { describe, expect, it, vi } from 'vitest'
import { createFakeContext } from '../test/fake-ctx.ts'
import { App } from './entries/App.tsx'
import { apply } from './index.ts'

// The seed store engine imports zustand/vanilla, zustand/middleware, zustand/shallow and immer at module
// top level, and this package installs none of them, so the real engine cannot load in a unit test.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (spec: { init: () => unknown }) => ({
    spec,
    create: () => ({
      getSnapshot: () => spec.init(),
      subscribe: () => () => {},
      clearPersisted: () => {},
      actions: {},
    }),
  }),
}))

describe('client apply', () => {
  it('TestIndex_A1 registers exactly one root entry for App and clears it on dispose', () => {
    const ctx = createFakeContext()
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

  it('TestIndex_A2 registers the webui namespace with matching zh and en dictionaries', () => {
    const ctx = createFakeContext()
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
