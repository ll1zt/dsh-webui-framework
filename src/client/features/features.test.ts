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

describe('webuiLayout waits for the block slots', () => {
  const ROOT_KEY = 'webui.block.root'
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  function host(): { fake: ReturnType<typeof createFakeContext>; root: Context } {
    const fake = createFakeContext()
    const root = new Context()
    root.provide('slots', fake.slots)
    root.provide('locale', fake.locale)
    return { fake, root }
  }

  it('A3 the layout feature provides webuiLayout only after the block slots are declared', async () => {
    const { fake, root } = host()
    await root.plugin(featureNamed('layout'))

    // A counter, not a spy: an assertion failure must not print a cordis context.
    let starts = 0
    const waiting = root.plugin({ name: 'alpha', inject: ['webuiLayout'], apply: () => void (starts += 1) })
    await flush()
    expect(starts).toBe(0)

    fake.slots.declare(ROOT_KEY)
    await waiting
    await flush()
    expect(starts).toBe(1)
  })

  it('A3 with the shell applied first webuiLayout is provided without a further declaration', async () => {
    const { root } = host()
    await root.plugin(featureNamed('shell'))
    await root.plugin(featureNamed('layout'))

    let starts = 0
    root.inject(['webuiLayout'], () => void (starts += 1))
    await flush()

    expect(starts).toBe(1)
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
    const fiber = await root.plugin({
      name: 'alpha',
      inject: ['webuiLayout'],
      apply: (ctx: Context) => void captured.push(ctx),
    })
    const alpha = captured[0]
    if (alpha === undefined) throw new Error('the contributor plugin did not start')
    const dispose = registerBlock(alpha, 'X')
    const slots: FakeSlots = fake.slots
    const inject = slots.entries('root')[0]?.options.inject
    if (typeof inject !== 'function') throw new Error('the root registration has no inject factory')
    return { fake, face: inject() as Face, root, alpha, fiber, dispose }
  }

  /** Register a root-scope block through a contributor's `webuiLayout`. */
  function registerBlock(ctx: Context, id: string): () => void {
    const meta = { id, scope: 'root', priority: 0, title: { zh: id, en: id }, closable: true } as const
    return ctx.webuiLayout.registerBlock({ ...meta, multiInstance: false }, () => null)
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

  it('A3 retryBlock clears only the retried block while another registered block stays failed', async () => {
    const { fake, face, alpha } = await loaded()
    registerBlock(alpha, 'Y')
    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'X' } }, new Error('x'), { abdicated: true })
    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'Y' } }, new Error('y'), { abdicated: true })
    expect(face.hooks.errors.getSnapshot().has('Y')).toBe(true)

    face.retryBlock('X')

    expect(face.hooks.errors.getSnapshot().has('X')).toBe(false)
    expect(face.hooks.errors.getSnapshot().has('Y')).toBe(true)
  })

  it('A2 a failure is dropped when the block is unregistered by its disposer, and stays gone after it registers again', async () => {
    const { fake, face, alpha, dispose } = await loaded()
    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'X' } }, new Error('boom'), { abdicated: true })
    expect(face.hooks.errors.getSnapshot().has('X')).toBe(true)

    dispose()
    expect(face.hooks.errors.getSnapshot().has('X')).toBe(false)

    registerBlock(alpha, 'X')
    expect(face.hooks.errors.getSnapshot().has('X')).toBe(false)
  })

  it('A2 a failure is dropped when the contributor plugin unloads, and stays gone after a new contributor registers the id', async () => {
    const { fake, face, root, fiber } = await loaded()
    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'X' } }, new Error('boom'), { abdicated: true })
    expect(face.hooks.errors.getSnapshot().has('X')).toBe(true)

    await fiber.dispose()
    expect(face.hooks.errors.getSnapshot().has('X')).toBe(false)

    const captured: Context[] = []
    await root.plugin({ name: 'beta', inject: ['webuiLayout'], apply: (ctx: Context) => void captured.push(ctx) })
    if (captured[0] === undefined) throw new Error('the second contributor did not start')
    registerBlock(captured[0], 'X')
    expect(face.hooks.errors.getSnapshot().has('X')).toBe(false)
  })

  it('A3 retryBlock of an id that was not registered through webuiLayout keeps the failure', async () => {
    const { fake, face } = await loaded()
    fake.slots.reportEntryError(ROOT_KEY, { options: { id: 'F' } }, new Error('boom'), { abdicated: true })

    face.retryBlock('F')

    expect(face.hooks.errors.getSnapshot().has('F')).toBe(true)
  })
})

describe('layout persistence through optional services', () => {
  const META = { scope: 'root', priority: 0, closable: true, multiInstance: false } as const
  const pane = (...ids: string[]) => ({
    kind: 'pane',
    tabs: ids.map((blockId) => ({ blockId, contentId: '' })),
    active: 0,
  })
  const saved = (...ids: string[]) => ({ version: 1, root: pane(...ids), activePane: [] })

  interface DockFace {
    hooks: { dock: { getSnapshot(): { layout: { root: { tabs: { blockId: string }[] } | null } } } }
    dockActions: { open(target: { blockId: string }): void }
  }

  /** A configForms service over one form; `ready` decides whether the form already holds `layout`. */
  function configFormsOf(layout: unknown) {
    const form = {
      getSnapshot: () => ({ status: 'ready' as const, value: { layout } }),
      subscribe: () => () => undefined,
      set: vi.fn(() => Promise.resolve(true)),
    }
    const get = vi.fn((_id: string) => form)
    return { form, service: { get } }
  }

  /** Load shell and layout on a real root and register the blocks `ids` through a contributor. */
  async function loaded(provide: (root: Context) => void, ...ids: string[]) {
    const fake = createFakeContext()
    const root = new Context()
    root.provide('slots', fake.slots)
    root.provide('locale', fake.locale)
    provide(root)
    await root.plugin(featureNamed('shell'))
    await root.plugin(featureNamed('layout'))
    const captured: Context[] = []
    await root.plugin({ name: 'alpha', inject: ['webuiLayout'], apply: (ctx: Context) => void captured.push(ctx) })
    for (const id of ids) captured[0]?.webuiLayout.registerBlock({ ...META, id, title: { zh: id, en: id } }, () => null)
    const slots: FakeSlots = fake.slots
    const inject = slots.entries('root')[0]?.options.inject
    if (typeof inject !== 'function') throw new Error('the root registration has no inject factory')
    const face = inject() as DockFace
    const tabs = () => face.hooks.dock.getSnapshot().layout.root?.tabs.map((tab) => tab.blockId)
    return { root, face, tabs }
  }

  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

  it('A2 the saved layout in the configForms form of webui-framework is what the dock shows', async () => {
    const { form, service } = configFormsOf(saved('b', 'a'))

    const { tabs } = await loaded((root) => void root.provide('configForms', service), 'a', 'b')
    await flush()

    expect(service.get).toHaveBeenCalledWith('webui-framework')
    expect(form.set).not.toHaveBeenCalled()
    expect(tabs()).toEqual(['b', 'a'])
  })

  it('A6 without configForms the page starts with its layout in memory, and a configForms that arrives later is picked up', async () => {
    const bare = await loaded(() => undefined, 'a', 'b')
    expect(() => bare.face.dockActions.open({ blockId: 'a' })).not.toThrow()
    expect(bare.tabs()).toEqual(['a'])

    const { form, service } = configFormsOf(saved('b'))
    const waiting = await loaded(() => undefined, 'a', 'b')
    waiting.root.provide('configForms', service)
    await flush()

    expect(service.get).toHaveBeenCalledWith('webui-framework')
    expect(waiting.tabs()).toEqual(['b'])
    expect(form.set).not.toHaveBeenCalled()
  })

  it('A5 a saved block that has not registered stays until the loader finishes, and is dropped after', async () => {
    let finish: () => void = () => undefined
    const done = new Promise<void>((resolve) => (finish = resolve))
    const { service } = configFormsOf(saved('a', 'ghost'))

    const { tabs } = await loaded((root) => {
      root.provide('configForms', service)
      root.provide('loader', { await: () => done })
    }, 'a')
    await flush()
    expect(tabs()).toEqual(['a', 'ghost'])

    finish()
    await flush()
    expect(tabs()).toEqual(['a'])
  })

  it('A5 without a loader service the layout never settles, so the unregistered block stays', async () => {
    const { form, service } = configFormsOf(saved('a', 'ghost'))

    const { tabs } = await loaded((root) => void root.provide('configForms', service), 'a')
    await flush()

    expect(tabs()).toEqual(['a', 'ghost'])
    expect(form.set).not.toHaveBeenCalled()
  })

  it('A5 a saved block registering before the loader finishes is at its original place after', async () => {
    let finish: () => void = () => undefined
    const done = new Promise<void>((resolve) => (finish = resolve))
    const { service } = configFormsOf(saved('ghost', 'a'))
    const { tabs, root } = await loaded((host) => {
      host.provide('configForms', service)
      host.provide('loader', { await: () => done })
    }, 'a')
    await flush()
    const captured: Context[] = []
    await root.plugin({ name: 'late', inject: ['webuiLayout'], apply: (ctx: Context) => void captured.push(ctx) })
    captured[0]?.webuiLayout.registerBlock({ ...META, id: 'ghost', title: { zh: 'g', en: 'g' } }, () => null)

    finish()
    await flush()

    expect(tabs()).toEqual(['ghost', 'a'])
  })
})
