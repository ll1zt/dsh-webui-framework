import { Context } from '@deepseek-ai/cordis'
import type {
  BlockComponent,
  BlockMeta,
  BlockRef,
  LayoutNode,
  LayoutPreset,
  LayoutSize,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it, vi } from 'vitest'
import { emptyLayout } from '../../lib/layout.ts'
import { createFakeContext } from '../../test/fake-ctx.ts'
import { BlockRegistry } from './block-registry.ts'
import { LayoutController, type DockSnapshot } from './layout-controller.ts'

const Component: BlockComponent = () => null

function meta(id: string, over: Partial<BlockMeta> = {}): BlockMeta {
  return { id, scope: 'root', priority: 0, title: { zh: id, en: id }, closable: true, multiInstance: false, ...over }
}

function pane(active: number, ...refs: [string, string?][]): LayoutNode {
  return { kind: 'pane', tabs: refs.map(([blockId, contentId]) => ({ blockId, contentId: contentId ?? '' })), active }
}

function row(children: LayoutNode[], sizes: LayoutSize[]): LayoutNode {
  return { kind: 'split', axis: 'row', children, sizes }
}

function layoutOf(root: LayoutNode): WebuiLayout {
  return { version: 1, root, activePane: [] }
}

function presetOf(id: string, priority: number, root: LayoutNode): LayoutPreset {
  return { id, priority, layout: layoutOf(root) }
}

const px = (value: number): LayoutSize => ({ px: value, min: 100, max: 400 })
const FR: LayoutSize = { fr: 1 }

/** A real registry with a contributor context, the way block-registry.test.ts builds one. */
async function setup(blocks: BlockMeta[] = [], presets: LayoutPreset[] = []) {
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
  for (const block of blocks) registry.registerBlock(owner, block, Component)
  for (const preset of presets) registry.registerPreset(owner, preset)
  return { registry, owner, controller: new LayoutController(registry) }
}

function rootOf(snapshot: DockSnapshot): LayoutNode {
  const { root } = snapshot.layout
  if (root === null) throw new Error('layout has no root')
  return root
}

function tabsOf(snapshot: DockSnapshot): string[] {
  const node = rootOf(snapshot)
  if (node.kind !== 'pane') throw new Error('root is not a pane')
  return node.tabs.map((tab: BlockRef) => (tab.contentId === '' ? tab.blockId : `${tab.blockId}:${tab.contentId}`))
}

function activeOf(snapshot: DockSnapshot): number {
  const node = rootOf(snapshot)
  if (node.kind !== 'pane') throw new Error('root is not a pane')
  return node.active
}

function paneAt(snapshot: DockSnapshot, index: number) {
  const node = rootOf(snapshot)
  const child = node.kind === 'split' ? node.children[index] : undefined
  if (child?.kind !== 'pane') throw new Error(`child ${index} is not a pane`)
  return child
}

function sizesOf(snapshot: DockSnapshot): readonly LayoutSize[] {
  const node = rootOf(snapshot)
  if (node.kind !== 'split') throw new Error('root is not a split')
  return node.sizes
}

describe('LayoutController start', () => {
  it('A1 with no blocks and no presets the snapshot holds the empty layout and no blocks', async () => {
    const { controller } = await setup()

    expect(controller.getSnapshot()).toEqual({ layout: emptyLayout(), blocks: [] })
    expect(controller.getSnapshot()).toBe(controller.getSnapshot())
  })

  it('A1 the first preset by priority becomes the initial layout handed to the dock', async () => {
    const { controller, registry } = await setup(
      [meta('a'), meta('b')],
      [presetOf('late', 5, pane(0, ['b'])), presetOf('first', 1, pane(0, ['a']))],
    )

    expect(tabsOf(controller.getSnapshot())).toEqual(['a'])
    expect(controller.getSnapshot().blocks).toEqual(registry.blocks())
  })
})

describe('LayoutController actions', () => {
  it('A4 open, activate and close change the layout by the layout rules and notify subscribers', async () => {
    const { controller } = await setup([meta('a'), meta('b')])
    const listener = vi.fn()
    controller.subscribe(listener)
    const before = controller.getSnapshot()

    controller.actions.open({ blockId: 'a' })
    expect(tabsOf(controller.getSnapshot())).toEqual(['a'])
    expect(controller.getSnapshot()).not.toBe(before)
    expect(listener).toHaveBeenCalledTimes(1)

    controller.actions.open({ blockId: 'b' })
    expect(tabsOf(controller.getSnapshot())).toEqual(['a', 'b'])
    expect(activeOf(controller.getSnapshot())).toBe(1)

    controller.actions.activate({ blockId: 'a' })
    expect(activeOf(controller.getSnapshot())).toBe(0)

    controller.actions.close({ blockId: 'a' })
    expect(tabsOf(controller.getSnapshot())).toEqual(['b'])
  })

  it('A4 resize sets the size of the split slot holding the block', async () => {
    const { controller } = await setup(
      [meta('a'), meta('b')],
      [presetOf('p', 0, row([pane(0, ['a']), pane(0, ['b'])], [px(260), FR]))],
    )

    controller.actions.resize({ blockId: 'a' }, px(300))

    expect(sizesOf(controller.getSnapshot())).toEqual([px(300), FR])
  })

  it('A4 close does nothing to a block registered closable:false', async () => {
    const { controller } = await setup([meta('pin', { closable: false }), meta('a')])
    controller.actions.open({ blockId: 'a' })
    const before = controller.getSnapshot().layout

    controller.actions.close({ blockId: 'pin' })

    expect(tabsOf(controller.getSnapshot())).toContain('pin')
    expect(controller.getSnapshot().layout).toEqual(before)
  })

  it('A4 activate and resize find a single-instance block even when the target carries a contentId', async () => {
    const { controller } = await setup(
      [meta('a'), meta('b'), meta('c')],
      [presetOf('p', 0, row([pane(1, ['a'], ['b']), pane(0, ['c'])], [px(260), FR]))],
    )
    expect(paneAt(controller.getSnapshot(), 0).active).toBe(1)

    controller.actions.activate({ blockId: 'a', contentId: 'x' })
    expect(paneAt(controller.getSnapshot(), 0).active).toBe(0)

    controller.actions.resize({ blockId: 'a', contentId: 'x' }, px(320))
    expect(sizesOf(controller.getSnapshot())[0]).toEqual(px(320))
  })

  it('A4 a multi-instance block is still found by its exact contentId only', async () => {
    const { controller } = await setup(
      [meta('m', { multiInstance: true })],
      [presetOf('p', 0, pane(0, ['m', 'x'], ['m', 'y']))],
    )

    controller.actions.activate({ blockId: 'm', contentId: 'y' })
    expect(activeOf(controller.getSnapshot())).toBe(1)

    controller.actions.activate({ blockId: 'm', contentId: 'nope' })
    expect(activeOf(controller.getSnapshot())).toBe(1)
  })

  it('A4 resetToPreset re-adopts the preset that now ranks first, not the one the layout began with', async () => {
    const { controller, registry, owner } = await setup([meta('a'), meta('b')], [presetOf('p', 5, pane(0, ['a']))])
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.actions.open({ blockId: 'b' })
    expect(tabsOf(controller.getSnapshot())).toEqual(['a', 'b'])

    controller.actions.resetToPreset()
    expect(tabsOf(controller.getSnapshot())).toEqual(['a'])
    expect(listener).toHaveBeenCalled()

    registry.registerPreset(owner, presetOf('p0', 1, pane(0, ['b'])))
    expect(tabsOf(controller.getSnapshot())).toEqual(['a'])
    controller.actions.resetToPreset()
    expect(tabsOf(controller.getSnapshot())).toEqual(['b'])
  })

  it('A4 subscribers stop hearing changes once they unsubscribe', async () => {
    const { controller } = await setup([meta('a')])
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)

    unsubscribe()
    controller.actions.open({ blockId: 'a' })

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('LayoutController registry changes and saved layouts', () => {
  it('A4 a block registered later as closable:false appears in the layout and the block list', async () => {
    const { controller, registry, owner } = await setup()
    const listener = vi.fn()
    controller.subscribe(listener)

    const dispose = registry.registerBlock(owner, meta('pin', { closable: false }), Component)

    expect(tabsOf(controller.getSnapshot())).toEqual(['pin'])
    expect(controller.getSnapshot().blocks.map((block) => block.meta.id)).toEqual(['pin'])
    expect(listener).toHaveBeenCalled()

    listener.mockClear()
    dispose()
    expect(controller.getSnapshot().blocks).toEqual([])
    expect(listener).toHaveBeenCalled()
  })

  it('A4 replaceLayout adopts a saved layout and drops blocks that never registered only once settled', async () => {
    const { controller } = await setup([meta('a')])
    const listener = vi.fn()
    controller.subscribe(listener)
    const saved = layoutOf(pane(0, ['a'], ['ghost']))

    controller.replaceLayout(saved, false)
    expect(tabsOf(controller.getSnapshot())).toEqual(['a', 'ghost'])
    expect(listener).toHaveBeenCalled()

    controller.replaceLayout(saved, true)
    expect(tabsOf(controller.getSnapshot())).toEqual(['a'])
  })
})

describe('LayoutController resizeSplit', () => {
  const nested = () => row([pane(0, ['a']), row([pane(0, ['b']), pane(0, ['c'])], [FR, FR])], [px(260), FR])

  it('A3 resizeSplit on the root path replaces its sizes with px clamped, and notifies', async () => {
    const { controller } = await setup(
      [meta('a'), meta('b')],
      [presetOf('p', 0, row([pane(0, ['a']), pane(0, ['b'])], [px(260), FR]))],
    )
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.actions.resizeSplit([], [px(300), { fr: 2 }])
    expect(sizesOf(controller.getSnapshot())).toEqual([px(300), { fr: 2 }])
    expect(listener).toHaveBeenCalledTimes(1)

    controller.actions.resizeSplit([], [{ px: 900, min: 100, max: 400 }, FR])
    expect(sizesOf(controller.getSnapshot())).toEqual([px(400), FR])
    controller.actions.resizeSplit([], [{ px: 5, min: 100, max: 400 }, FR])
    expect(sizesOf(controller.getSnapshot())).toEqual([px(100), FR])
  })

  it('A3 resizeSplit reaches a nested split by its child-index path and leaves the rest alone', async () => {
    const { controller } = await setup([meta('a'), meta('b'), meta('c')], [presetOf('p', 0, nested())])

    controller.actions.resizeSplit([1], [{ fr: 3 }, { fr: 1 }])

    const root = rootOf(controller.getSnapshot())
    if (root.kind !== 'split') throw new Error('root is not a split')
    expect(root.sizes).toEqual([px(260), FR])
    expect(root.children[1]).toEqual(row([pane(0, ['b']), pane(0, ['c'])], [{ fr: 3 }, { fr: 1 }]))
  })

  it('A3 a path that is not a split, or sizes of the wrong length, change nothing and notify nobody', async () => {
    const { controller } = await setup([meta('a'), meta('b'), meta('c')], [presetOf('p', 0, nested())])
    const before = controller.getSnapshot()
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.actions.resizeSplit([0], [FR])
    controller.actions.resizeSplit([5], [FR, FR])
    controller.actions.resizeSplit([], [FR])
    controller.actions.resizeSplit([], [px(200), FR, FR])

    expect(controller.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('A3 resizeSplit counts as a user action: the layout stops following presets afterwards', async () => {
    const { controller, registry, owner } = await setup(
      [meta('a'), meta('b')],
      [presetOf('p', 5, row([pane(0, ['a']), pane(0, ['b'])], [px(260), FR]))],
    )

    controller.actions.resizeSplit([], [px(300), FR])
    registry.registerPreset(owner, presetOf('p0', 1, row([pane(0, ['a']), pane(0, ['b'])], [px(150), FR])))

    expect(sizesOf(controller.getSnapshot())).toEqual([px(300), FR])
  })
})

describe('LayoutController settle and late blocks', () => {
  it('A5 a saved block that is not registered yet keeps its tab, and shows at the original place once registered', async () => {
    const { controller, registry, owner } = await setup([meta('a')])
    expect(controller.settled).toBe(false)

    controller.replaceLayout(layoutOf(pane(1, ['ghost'], ['a'])), controller.settled)
    expect(tabsOf(controller.getSnapshot())).toEqual(['ghost', 'a'])

    registry.registerBlock(owner, meta('ghost'), Component)
    expect(tabsOf(controller.getSnapshot())).toEqual(['ghost', 'a'])
    expect(activeOf(controller.getSnapshot())).toBe(1)
  })

  it('A5 settle drops a block that is still unregistered, flips settled once, and keeps registered ones', async () => {
    const { controller } = await setup([meta('a')])
    controller.replaceLayout(layoutOf(pane(0, ['a'], ['ghost'])), controller.settled)
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.settle()
    expect(controller.settled).toBe(true)
    expect(tabsOf(controller.getSnapshot())).toEqual(['a'])
    expect(listener).toHaveBeenCalledTimes(1)

    controller.settle()
    expect(controller.settled).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('A5 a block registered before settle survives it, and a layout that needs no repair publishes nothing', async () => {
    const { controller, registry, owner } = await setup([meta('a')])
    controller.replaceLayout(layoutOf(pane(0, ['a'], ['late'])), controller.settled)
    registry.registerBlock(owner, meta('late'), Component)
    const before = controller.getSnapshot()
    const listener = vi.fn()
    controller.subscribe(listener)

    controller.settle()

    expect(controller.getSnapshot()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })

  it('A5 settle is not a user action: the layout still follows presets afterwards', async () => {
    const { controller, registry, owner } = await setup([meta('a'), meta('b')], [presetOf('p', 5, pane(0, ['a']))])

    controller.settle()
    registry.registerPreset(owner, presetOf('p0', 1, pane(0, ['b'])))

    expect(tabsOf(controller.getSnapshot())).toEqual(['b'])
  })
})

describe('LayoutController onAction', () => {
  it('A3 each action that changes the layout calls the listener once with the new layout, resizeSplit included', async () => {
    const { controller } = await setup(
      [meta('a'), meta('b'), meta('c')],
      [presetOf('p', 0, row([pane(0, ['a']), pane(0, ['b'], ['c'])], [px(260), FR]))],
    )
    const listener = vi.fn()
    controller.onAction(listener)
    const actions = controller.actions
    const steps: (() => void)[] = [
      () => actions.close({ blockId: 'c' }),
      () => actions.open({ blockId: 'c' }),
      () => actions.activate({ blockId: 'b' }),
      () => actions.resize({ blockId: 'a' }, px(320)),
      () => actions.resizeSplit([], [px(300), FR]),
      () => actions.resetToPreset(),
    ]

    for (const [index, step] of steps.entries()) {
      listener.mockClear()
      const before = controller.getSnapshot().layout
      step()
      expect(controller.getSnapshot().layout, `step ${index} changes the layout`).not.toEqual(before)
      expect(listener, `step ${index}`).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0]?.[0], `step ${index}`).toBe(controller.getSnapshot().layout)
    }
  })

  it('A3 an action that changes nothing does not call the listener', async () => {
    const { controller } = await setup(
      [meta('a'), meta('b')],
      [presetOf('p', 0, row([pane(0, ['a']), pane(0, ['b'])], [px(260), FR]))],
    )
    const listener = vi.fn()
    controller.onAction(listener)

    controller.actions.resizeSplit([0], [FR])
    controller.actions.resizeSplit([], [FR])
    controller.actions.resizeSplit([], [px(200), FR, FR])

    expect(listener).not.toHaveBeenCalled()
  })

  it('A3 replaceLayout, settle and registry changes never reach the listener', async () => {
    const { controller, registry, owner } = await setup([meta('a')], [presetOf('p', 5, pane(0, ['a']))])
    const listener = vi.fn()
    controller.onAction(listener)

    controller.replaceLayout(layoutOf(pane(0, ['a'], ['ghost'])), false)
    registry.registerBlock(owner, meta('b'), Component)
    controller.settle()
    registry.registerPreset(owner, presetOf('p0', 1, pane(0, ['b'])))

    expect(listener).not.toHaveBeenCalled()
  })

  it('A3 a listener stops hearing actions once it unsubscribes', async () => {
    const { controller } = await setup([meta('a')])
    const listener = vi.fn()
    const unsubscribe = controller.onAction(listener)

    unsubscribe()
    controller.actions.open({ blockId: 'a' })

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('LayoutController beginResize / endResize', () => {
  const twoPanes = () => row([pane(0, ['a']), pane(0, ['b'])], [px(260), FR])
  /** The first pane holds tabs a and c, so closing c keeps the split. */
  const tabsRow = () => row([pane(0, ['a'], ['c']), pane(0, ['b'])], [px(260), FR])

  async function gesture(root = twoPanes()) {
    const { controller } = await setup([meta('a'), meta('b'), meta('c')], [presetOf('p', 0, root)])
    const onAction = vi.fn<(layout: WebuiLayout) => void>()
    const subscriber = vi.fn()
    controller.onAction(onAction)
    controller.subscribe(subscriber)
    return { controller, onAction, subscriber }
  }

  it('A2 between begin and end resizeSplit publishes at once but calls no onAction listener', async () => {
    const { controller, onAction, subscriber } = await gesture()

    controller.actions.beginResize()
    controller.actions.resizeSplit([], [px(280), FR])
    expect(sizesOf(controller.getSnapshot())).toEqual([px(280), FR])
    expect(subscriber).toHaveBeenCalledTimes(1)
    controller.actions.resizeSplit([], [px(300), FR])
    expect(sizesOf(controller.getSnapshot())).toEqual([px(300), FR])
    expect(subscriber).toHaveBeenCalledTimes(2)

    expect(onAction).not.toHaveBeenCalled()
  })

  it('A2 endResize after a change calls every listener exactly once with the final layout', async () => {
    const { controller, onAction } = await gesture()
    const second = vi.fn<(layout: WebuiLayout) => void>()
    controller.onAction(second)

    controller.actions.beginResize()
    controller.actions.resizeSplit([], [px(280), FR])
    controller.actions.resizeSplit([], [px(300), FR])
    controller.actions.endResize()

    for (const listener of [onAction, second]) {
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(controller.getSnapshot().layout)
    }
    controller.actions.endResize()
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('A2 endResize without a change calls no listener', async () => {
    const { controller, onAction } = await gesture()

    controller.actions.beginResize()
    controller.actions.endResize()
    controller.actions.beginResize()
    controller.actions.resizeSplit([5], [FR, FR])
    controller.actions.resizeSplit([], [FR])
    controller.actions.endResize()

    expect(onAction).not.toHaveBeenCalled()
  })

  it('A2 a lone endResize does nothing, and a repeated beginResize still ends in one notification', async () => {
    const { controller, onAction } = await gesture()

    controller.actions.endResize()
    expect(onAction).not.toHaveBeenCalled()

    controller.actions.beginResize()
    controller.actions.resizeSplit([], [px(280), FR])
    controller.actions.beginResize()
    controller.actions.resizeSplit([], [px(320), FR])
    controller.actions.endResize()

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith(controller.getSnapshot().layout)
    expect(sizesOf(controller.getSnapshot())).toEqual([px(320), FR])
  })

  it('A2 a repeated beginResize does not move the baseline: a change made before it still counts', async () => {
    const { controller, onAction } = await gesture()

    controller.actions.beginResize()
    controller.actions.resizeSplit([], [px(280), FR])
    controller.actions.beginResize()
    controller.actions.endResize()

    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('A2 other actions during a gesture still notify at once', async () => {
    const { controller, onAction } = await gesture()

    controller.actions.beginResize()
    controller.actions.close({ blockId: 'b' })

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenLastCalledWith(controller.getSnapshot().layout)
  })

  it('A1 a close during a gesture notifies once, and endResize adds nothing', async () => {
    const { controller, onAction } = await gesture()

    controller.actions.beginResize()
    controller.actions.close({ blockId: 'b' })
    expect(onAction).toHaveBeenCalledTimes(1)
    controller.actions.endResize()

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenLastCalledWith(controller.getSnapshot().layout)
  })

  it('A2 a close after a drag resize notifies at once with the dragged sizes, and endResize adds nothing', async () => {
    const { controller, onAction } = await gesture(tabsRow())

    controller.actions.beginResize()
    controller.actions.resizeSplit([], [px(300), FR])
    controller.actions.close({ blockId: 'c' })

    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenLastCalledWith(controller.getSnapshot().layout)
    expect(sizesOf(controller.getSnapshot())).toEqual([px(300), FR])

    controller.actions.endResize()
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('A3 a resize after a close during a gesture is notified once more by endResize, with the final layout', async () => {
    const { controller, onAction } = await gesture(tabsRow())

    controller.actions.beginResize()
    controller.actions.close({ blockId: 'c' })
    expect(onAction).toHaveBeenCalledTimes(1)
    controller.actions.resizeSplit([], [px(320), FR])
    expect(onAction).toHaveBeenCalledTimes(1)
    controller.actions.endResize()

    expect(onAction).toHaveBeenCalledTimes(2)
    expect(onAction).toHaveBeenLastCalledWith(controller.getSnapshot().layout)
    expect(sizesOf(controller.getSnapshot())).toEqual([px(320), FR])
  })
})
