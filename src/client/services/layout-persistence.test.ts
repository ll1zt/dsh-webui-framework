import { Context } from '@deepseek-ai/cordis'
import type {
  BlockComponent,
  BlockMeta,
  LayoutNode,
  LayoutPreset,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeContext } from '../../test/fake-ctx.ts'
import { BlockRegistry } from './block-registry.ts'
import { LayoutController } from './layout-controller.ts'
import { LAYOUT_NAMESPACE, LayoutPersistence, type LayoutConfigForm } from './layout-persistence.ts'
import { LOG_PREFIX } from './log-prefix.ts'

const Component: BlockComponent = () => null

function meta(id: string): BlockMeta {
  return { id, scope: 'root', priority: 0, title: { zh: id, en: id }, closable: true, multiInstance: false }
}

function pane(active: number, ...ids: string[]): LayoutNode {
  return { kind: 'pane', tabs: ids.map((blockId) => ({ blockId, contentId: '' })), active }
}

function layoutOf(root: LayoutNode): WebuiLayout {
  return { version: 1, root, activePane: [] }
}

function tabsOf(controller: LayoutController): string[] {
  const { root } = controller.getSnapshot().layout
  if (root?.kind !== 'pane') throw new Error('root is not a pane')
  return root.tabs.map((tab) => tab.blockId)
}

/** A real registry with blocks `a` and `b` and the preset `[a]`, under a real controller. */
async function setup() {
  const fake = createFakeContext()
  const root = new Context()
  root.provide('slots', fake.slots)
  const captured: Context[] = []
  await root.plugin({ name: 'alpha', apply: (ctx: Context) => void captured.push(ctx) })
  const owner = captured[0]
  if (owner === undefined) throw new Error('contributor alpha did not start')
  const registry = new BlockRegistry()
  registry.registerBlock(owner, meta('a'), Component)
  registry.registerBlock(owner, meta('b'), Component)
  const preset: LayoutPreset = { id: 'p', priority: 0, layout: layoutOf(pane(0, 'a')) }
  registry.registerPreset(owner, preset)
  return { controller: new LayoutController(registry), registry, owner }
}

type Status = 'loading' | 'ready' | 'unavailable'

/** A form whose snapshot the test moves; `set` is a spy resolving true unless told otherwise. */
function fakeForm(status: Status, layout?: unknown) {
  const listeners = new Set<() => void>()
  let snapshot = { status, value: status === 'ready' ? { layout } : undefined }
  const form = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set: vi.fn<LayoutConfigForm['set']>(() => Promise.resolve(true)),
  } satisfies LayoutConfigForm
  return {
    form,
    move(next: Status, nextLayout?: unknown): void {
      snapshot = { status: next, value: next === 'ready' ? { layout: nextLayout } : undefined }
      for (const listener of [...listeners]) listener()
    },
    listenerCount: () => listeners.size,
  }
}

/** Let promise callbacks (and a macrotask) run. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LayoutPersistence reading the saved layout', () => {
  it('A2 the namespace is the loader row id of the plugin', () => {
    expect(LAYOUT_NAMESPACE).toBe('webui-framework')
  })

  it('A2 a ready form with a saved layout makes the controller adopt it, repaired', async () => {
    const { controller } = await setup()
    const { form } = fakeForm('ready', layoutOf(pane(1, 'a', 'b', 'a')))

    new LayoutPersistence(controller, form).start()

    expect(tabsOf(controller)).toEqual(['a', 'b'])
    expect(controller.getSnapshot().layout.root).toEqual(pane(1, 'a', 'b'))
  })

  it('A2 a saved layout gets the controller settled flag, so unsettled keeps unknown blocks and settled drops them', async () => {
    const first = await setup()
    new LayoutPersistence(first.controller, fakeForm('ready', layoutOf(pane(0, 'a', 'ghost'))).form).start()
    expect(tabsOf(first.controller)).toEqual(['a', 'ghost'])

    const second = await setup()
    second.controller.settle()
    new LayoutPersistence(second.controller, fakeForm('ready', layoutOf(pane(0, 'a', 'ghost'))).form).start()
    expect(tabsOf(second.controller)).toEqual(['a'])
  })

  it('A2 a ready form without a layout, or with an unusable one, leaves the first preset', async () => {
    const { controller } = await setup()
    new LayoutPersistence(controller, fakeForm('ready').form).start()
    expect(tabsOf(controller)).toEqual(['a'])

    const other = await setup()
    new LayoutPersistence(other.controller, fakeForm('ready', { nonsense: true }).form).start()
    expect(tabsOf(other.controller)).toEqual(['a'])
  })

  it('A2 a loading form is waited for: the saved layout is adopted when it turns ready', async () => {
    const { controller } = await setup()
    const fake = fakeForm('loading')
    new LayoutPersistence(controller, fake.form).start()
    expect(tabsOf(controller)).toEqual(['a'])

    fake.move('ready', layoutOf(pane(0, 'b')))

    expect(tabsOf(controller)).toEqual(['b'])
  })

  it('A2 an unavailable form leaves the controller as it is', async () => {
    const { controller } = await setup()
    const fake = fakeForm('loading')
    new LayoutPersistence(controller, fake.form).start()

    fake.move('unavailable')

    expect(tabsOf(controller)).toEqual(['a'])
  })

  it('A2 the saved layout is applied at most once; later form changes do not replace the layout', async () => {
    const { controller } = await setup()
    const fake = fakeForm('ready', layoutOf(pane(0, 'b')))
    new LayoutPersistence(controller, fake.form).start()

    fake.move('ready', layoutOf(pane(0, 'a')))

    expect(tabsOf(controller)).toEqual(['b'])
  })

  it('A2 a user action before the form is ready means the saved layout is never applied', async () => {
    const { controller } = await setup()
    const fake = fakeForm('loading')
    new LayoutPersistence(controller, fake.form).start()
    controller.actions.open({ blockId: 'b' })
    const mine = controller.getSnapshot().layout

    fake.move('ready', layoutOf(pane(0, 'b')))

    expect(controller.getSnapshot().layout).toBe(mine)
    expect(tabsOf(controller)).toEqual(['a', 'b'])
  })
})

describe('LayoutPersistence writing', () => {
  it('A3 one user action writes exactly one set of the layout key with the new layout', async () => {
    const { controller } = await setup()
    const { form } = fakeForm('ready')
    new LayoutPersistence(controller, form).start()

    controller.actions.open({ blockId: 'b' })
    await flush()

    expect(form.set).toHaveBeenCalledTimes(1)
    expect(form.set).toHaveBeenCalledWith('layout', controller.getSnapshot().layout)
    expect(tabsOf(controller)).toEqual(['a', 'b'])

    controller.actions.close({ blockId: 'a' })
    expect(form.set).toHaveBeenCalledTimes(2)
    expect(form.set).toHaveBeenLastCalledWith('layout', controller.getSnapshot().layout)
  })

  it('A3 adopting the saved layout, the settle re-resolve and a registry change write nothing', async () => {
    const { controller, registry, owner } = await setup()
    const { form } = fakeForm('ready', layoutOf(pane(0, 'a', 'ghost')))
    new LayoutPersistence(controller, form).start()

    controller.settle()
    registry.registerBlock(owner, meta('c'), Component)
    await flush()

    expect(tabsOf(controller)).toEqual(['a'])
    expect(form.set).not.toHaveBeenCalled()
  })

  it('A3 the disposer stops the writes and the reading', async () => {
    const { controller } = await setup()
    const fake = fakeForm('loading')
    const stop = new LayoutPersistence(controller, fake.form).start()

    stop()
    expect(fake.listenerCount()).toBe(0)
    fake.move('ready', layoutOf(pane(0, 'b')))
    controller.actions.open({ blockId: 'b' })
    await flush()

    expect(tabsOf(controller)).toEqual(['a', 'b'])
    expect(fake.form.set).not.toHaveBeenCalled()
  })
})

describe('LayoutPersistence when the write fails', () => {
  async function failing(outcome: 'false' | 'reject') {
    const { controller } = await setup()
    const fake = fakeForm('ready')
    fake.form.set.mockImplementation(() =>
      outcome === 'false' ? Promise.resolve(false) : Promise.reject(new Error('disk full')),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    new LayoutPersistence(controller, fake.form).start()
    return { controller, fake, warn }
  }

  it.each(['false', 'reject'] as const)(
    'A4 a set that %s does not throw, warns one prefixed line and keeps the layout',
    async (outcome) => {
      const { controller, fake, warn } = await failing(outcome)

      expect(() => controller.actions.open({ blockId: 'b' })).not.toThrow()
      await flush()

      expect(fake.form.set).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0]?.[0]).startsWith(LOG_PREFIX)).toBe(true)
      expect(tabsOf(controller)).toEqual(['a', 'b'])
      expect(fake.form.getSnapshot().value).toEqual({ layout: undefined })
    },
  )

  it('A4 a set that resolves true warns nothing', async () => {
    const { controller } = await setup()
    const { form } = fakeForm('ready')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    new LayoutPersistence(controller, form).start()

    controller.actions.open({ blockId: 'b' })
    await flush()

    expect(warn).not.toHaveBeenCalled()
  })
})
