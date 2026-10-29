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
