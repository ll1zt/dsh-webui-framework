// @vitest-environment happy-dom
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeContext, type FakeSlots } from '../../test/fake-ctx.ts'
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
    expect(featureNamed('layout').inject).toEqual(['slots'])
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

describe('webuiLayout without the layout feature', () => {
  it('A6 a contributor waiting on webuiLayout never starts while the shell still registers root', async () => {
    const fake = createFakeContext()
    const root = new Context()
    root.provide('slots', fake.slots)
    root.provide('locale', fake.locale)
    const started = vi.fn()

    const waiting = root.inject(['webuiLayout'], started)
    await root.plugin(featureNamed('shell'))

    expect(started).not.toHaveBeenCalled()
    expect(fake.slots.entries('root')).toHaveLength(1)
    await waiting.dispose()
  })
})

describe('root registration and webuiLayout', () => {
  it('A1 the controller the root seat injects sees the blocks registered through ctx.webuiLayout', async () => {
    const fake = createFakeContext()
    const root = new Context()
    root.provide('slots', fake.slots)
    root.provide('locale', fake.locale)
    await root.plugin(featureNamed('shell'))
    await root.plugin(featureNamed('layout'))

    const captured: Context[] = []
    await root.plugin({ name: 'alpha', inject: ['webuiLayout'], apply: (ctx: Context) => void captured.push(ctx) })
    const meta = {
      id: 'a',
      scope: 'root',
      priority: 0,
      title: { zh: 'a', en: 'a' },
      closable: true,
      multiInstance: false,
    }
    captured[0]?.webuiLayout.registerBlock({ ...meta, scope: 'root' }, () => null)

    const slots: FakeSlots = fake.slots
    const inject = slots.entries('root')[0]?.options.inject
    if (typeof inject !== 'function') throw new Error('the root registration has no inject factory')
    const face = inject() as { hooks: { dock: { getSnapshot(): { blocks: { meta: { id: string } }[] } } } }
    expect(face.hooks.dock.getSnapshot().blocks.map((block) => block.meta.id)).toEqual(['a'])
  })
})

describe('block failures through the root seat', () => {
  const ROOT_KEY = 'webui.block.root'

  interface Face {
    hooks: { errors: { getSnapshot(): ReadonlyMap<string, { blockId: string; error: Error }> } }
    retryBlock(blockId: string): void
  }

  /** Load shell and layout, register block X through a contributor, and hand back the root inject face. */
  async function loaded() {
    const fake = createFakeContext()
    const root = new Context()
    root.provide('slots', fake.slots)
    root.provide('locale', fake.locale)
    await root.plugin(featureNamed('shell'))
    await root.plugin(featureNamed('layout'))
    const captured: Context[] = []
    await root.plugin({ name: 'alpha', inject: ['webuiLayout'], apply: (ctx: Context) => void captured.push(ctx) })
    const meta = { id: 'X', scope: 'root', priority: 0, title: { zh: 'X', en: 'X' }, closable: true } as const
    captured[0]?.webuiLayout.registerBlock({ ...meta, multiInstance: false }, () => null)
    const slots: FakeSlots = fake.slots
    const inject = slots.entries('root')[0]?.options.inject
    if (typeof inject !== 'function') throw new Error('the root registration has no inject factory')
    return { fake, face: inject() as Face }
  }

  it('A1 a failure reported for a block entry shows in the errors the root seat injects', async () => {
    const { fake, face } = await loaded()
    const error = new Error('boom')

    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'X' } }, error, { abdicated: true })

    expect(face.hooks.errors.getSnapshot().get('X')).toEqual({ blockId: 'X', error })
  })

  it('A4 a report under another slot key leaves the errors empty', async () => {
    const { fake, face } = await loaded()

    fake.slots.reportEntryError('root', { options: { id: 'X' } }, new Error('boom'), { abdicated: true })

    expect(face.hooks.errors.getSnapshot().size).toBe(0)
  })

  it('A3 retryBlock re-registers the block entry through its owner and clears the failure', async () => {
    const { fake, face } = await loaded()
    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'X' } }, new Error('boom'), { abdicated: true })
    const original = fake.slots.entries(ROOT_KEY)[0]

    face.retryBlock('X')

    const entries = fake.slots.entries(ROOT_KEY)
    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toBe(original)
    expect(entries[0]?.options.id).toBe('X')
    expect(face.hooks.errors.getSnapshot().size).toBe(0)
  })

  it('A3 retryBlock of an id that was not registered through webuiLayout keeps the failure', async () => {
    const { fake, face } = await loaded()
    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'F' } }, new Error('boom'), { abdicated: true })

    face.retryBlock('F')

    expect(face.hooks.errors.getSnapshot().has('F')).toBe(true)
  })
})
