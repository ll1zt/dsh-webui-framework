// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createFakeContext } from '../../test/fake-ctx.ts'
import * as entry from '../index.ts'
import { FEATURES, type WebuiFeature } from './index.ts'

function featureNamed(name: string): WebuiFeature {
  const feature = FEATURES.find((candidate) => candidate.name === name)
  if (feature === undefined) throw new Error(`FEATURES has no feature named ${name}`)
  return feature
}

describe('FEATURES', () => {
  it('A1 apply calls ctx.plugin exactly once per feature and the entry module exports no inject', () => {
    const plugged: unknown[] = []
    const ctx = createFakeContext({ plugin: (feature: unknown) => void plugged.push(feature) })
    entry.apply(ctx)

    expect(plugged).toHaveLength(FEATURES.length)
    for (const feature of FEATURES) expect(plugged.filter((candidate) => candidate === feature)).toHaveLength(1)
    expect('inject' in entry).toBe(false)
    ctx.disposeAll()
  })

  it('A1 feature names are unique and each feature declares only the services it uses', () => {
    const names = FEATURES.map((feature) => feature.name)
    expect(new Set(names).size).toBe(names.length)
    expect(featureNamed('shell').inject).toEqual(['slots', 'locale'])
    expect(featureNamed('theme').inject).toEqual(['theme'])
  })
})

describe('client apply without the theme service', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-ds-dark-theme')
    for (const meta of document.head.querySelectorAll('meta')) meta.remove()
  })

  it('A2 only the theme feature stays inactive while the rest of the page registers', () => {
    const ctx = createFakeContext()
    expect(() => entry.apply(ctx)).not.toThrow()

    expect(ctx.slots.entries('root')).toHaveLength(1)
    expect(ctx.locale.registrations.some((registration) => registration.namespace === 'webui')).toBe(true)
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(0)
    expect(ctx.activePlugins).not.toContain('theme')
    expect(ctx.activePlugins).toContain('shell')
    ctx.disposeAll()
  })
})
