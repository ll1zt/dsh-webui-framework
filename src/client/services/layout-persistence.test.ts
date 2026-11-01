// @vitest-environment happy-dom
import { Context } from '@deepseek-ai/cordis'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useSyncExternalStore, type ReactNode } from 'react'
import type {
  BlockComponent,
  BlockMeta,
  LayoutNode,
  LayoutPreset,
  LayoutSize,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockView } from '../../ui/shell/DockView.tsx'
import type { WebuiTranslate } from '../types.ts'
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
async function setup(initial: LayoutNode = pane(0, 'a')) {
  const fake = createFakeContext()
  // Blocks enter a declared slot only; the root entry's children table is what declares these keys.
  fake.slots.declare('webui.block.root')
  fake.slots.declare('webui.block.session')
  const root = new Context()
  root.provide('slots', fake.slots)
  const captured: Context[] = []
  await root.plugin({ name: 'alpha', apply: (ctx: Context) => void captured.push(ctx) })
  const owner = captured[0]
  if (owner === undefined) throw new Error('contributor alpha did not start')
  const registry = new BlockRegistry()
  registry.registerBlock(owner, meta('a'), Component)
  registry.registerBlock(owner, meta('b'), Component)
  const preset: LayoutPreset = { id: 'p', priority: 0, layout: layoutOf(initial) }
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
  cleanup()
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

  it('A5 undo and redo are user actions: each writes the layout it published', async () => {
    const { controller } = await setup()
    const { form } = fakeForm('ready')
    new LayoutPersistence(controller, form).start()
    controller.actions.open({ blockId: 'b' })
    const opened = controller.getSnapshot().layout
    await flush()

    controller.actions.undo()
    await flush()

    expect(tabsOf(controller)).toEqual(['a'])
    expect(form.set).toHaveBeenCalledTimes(2)
    expect(form.set).toHaveBeenLastCalledWith('layout', controller.getSnapshot().layout)

    controller.actions.redo()
    await flush()

    expect(form.set).toHaveBeenCalledTimes(3)
    expect(form.set).toHaveBeenLastCalledWith('layout', opened)
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

describe('LayoutPersistence with a splitter dragged through the dock', () => {
  const px = (value: number): LayoutSize => ({ px: value, min: 100, max: 400 })
  const FR: LayoutSize = { fr: 1 }
  const t = ((key: string) => key) as WebuiTranslate

  /** The dock over a real controller, saving through the fake form; returns the separator and the form. */
  async function dock() {
    const split: LayoutNode = {
      kind: 'split',
      axis: 'row',
      children: [pane(0, 'a'), pane(0, 'b')],
      sizes: [px(200), FR],
    }
    const { controller } = await setup(split)
    const { form } = fakeForm('ready')
    new LayoutPersistence(controller, form).start()
    function Harness(): ReactNode {
      const snapshot = useSyncExternalStore(
        (listener) => controller.subscribe(listener),
        () => controller.getSnapshot(),
      )
      return createElement(DockView, {
        snapshot,
        actions: controller.actions,
        view: controller.view,
        renderBlock: (blockMeta) => createElement('div', null, blockMeta.id),
        t,
        language: 'en',
      })
    }
    render(createElement(Harness))
    const separator = screen.getByRole('separator', { name: 'dock.splitter' })
    Object.assign(separator, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    return { controller, form, separator }
  }

  it('A4 dragging the separator writes nothing until pointerup, then exactly once with the final layout', async () => {
    const { controller, form, separator } = await dock()
    const before = controller.getSnapshot().layout

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 110 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 120 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 130 })
    await flush()

    expect(controller.getSnapshot().layout).not.toBe(before)
    expect(form.set).not.toHaveBeenCalled()

    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 130 })
    await flush()

    expect(form.set).toHaveBeenCalledTimes(1)
    expect(form.set).toHaveBeenCalledWith('layout', controller.getSnapshot().layout)
    const { root } = controller.getSnapshot().layout
    expect(root?.kind === 'split' ? root.sizes : undefined).toEqual([px(230), FR])
  })

  it('A5 one ArrowRight on the separator writes exactly once with the new layout', async () => {
    const { controller, form, separator } = await dock()

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    await flush()

    expect(form.set).toHaveBeenCalledTimes(1)
    expect(form.set).toHaveBeenCalledWith('layout', controller.getSnapshot().layout)
    const { root } = controller.getSnapshot().layout
    expect(root?.kind === 'split' ? root.sizes : undefined).toEqual([px(208), FR])
  })
})
