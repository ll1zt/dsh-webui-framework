import type {
  BlockMeta,
  BlockRef,
  LayoutNode,
  LayoutPane,
  LayoutSize,
  LayoutSplit,
  OpenPlacement,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it } from 'vitest'
import type { LayoutCatalog } from './layout.ts'
import { emptyLayout } from './layout.ts'
import { openBeside } from './layout-ops.ts'
import { deepFreeze } from '../test/deep-freeze.ts'

const FR: LayoutSize = { fr: 1 }
const LEFT: LayoutSize = { px: 260, min: 180, max: 480 }

function meta(id: string, over: Partial<BlockMeta> = {}): BlockMeta {
  return { id, scope: 'root', priority: 0, title: { zh: id, en: id }, closable: true, multiInstance: false, ...over }
}

function catalog(...blocks: BlockMeta[]): LayoutCatalog {
  return { blocks: new Map(blocks.map((block) => [block.id, block])), settled: true }
}

const tab = (blockId: string, contentId = ''): BlockRef => ({ blockId, contentId })
const pane = (active: number, ...tabs: BlockRef[]): LayoutPane => ({ kind: 'pane', tabs, active })
const single = (blockId: string, contentId = ''): LayoutPane => pane(0, tab(blockId, contentId))
const row = (children: LayoutNode[], sizes: LayoutSize[]): LayoutSplit => ({ kind: 'split', axis: 'row', children, sizes })
const col = (children: LayoutNode[], sizes: LayoutSize[]): LayoutSplit => ({
  kind: 'split',
  axis: 'column',
  children,
  sizes,
})
const layoutOf = (root: LayoutNode | null, activePane: number[] = []): WebuiLayout => ({
  version: 1,
  root,
  activePane,
})

const BLOCKS = catalog(meta('a'), meta('b'), meta('c'), meta('d'), meta('m', { multiInstance: true }))

const place = (blockId: string, side: OpenPlacement['side'], contentId?: string): OpenPlacement => ({
  beside: contentId === undefined ? { blockId } : { blockId, contentId },
  side,
})

/** How many tabs in the tree have this blockId and contentId. */
function tabsMatching(layout: WebuiLayout, blockId: string, contentId: string): number {
  const walk = (node: LayoutNode | null): number => {
    if (node === null) return 0
    if (node.kind === 'pane') {
      return node.tabs.filter((item) => item.blockId === blockId && item.contentId === contentId).length
    }
    return node.children.reduce((sum, child) => sum + walk(child), 0)
  }
  return walk(layout.root)
}

describe('openBeside', () => {
  it('A2 puts a new pane on each side of the beside pane, both sides fr 1, and activates the new tab', () => {
    const layout = deepFreeze(layoutOf(pane(0, tab('a'), tab('b'))))
    const beside = pane(0, tab('a'), tab('b'))
    const opened = single('c')
    const cases = [
      { side: 'left', axis: 'row', index: 0 },
      { side: 'right', axis: 'row', index: 1 },
      { side: 'top', axis: 'column', index: 0 },
      { side: 'bottom', axis: 'column', index: 1 },
    ] as const

    for (const { side, axis, index } of cases) {
      const next = openBeside(layout, { blockId: 'c' }, place('a', side), BLOCKS)
      const children = index === 0 ? [opened, beside] : [beside, opened]
      expect(next, side).toEqual(layoutOf({ kind: 'split', axis, children, sizes: [FR, FR] }, [index]))
    }
  })

  it('A2 splits the pane that holds the beside tab rather than the whole layout', () => {
    const layout = deepFreeze(layoutOf(row([single('a'), pane(1, tab('b'), tab('d'))], [LEFT, FR]), [0]))

    const next = openBeside(layout, { blockId: 'c' }, place('d', 'right'), BLOCKS)

    expect(next).toEqual(
      layoutOf(row([single('a'), row([pane(1, tab('b'), tab('d')), single('c')], [FR, FR])], [LEFT, FR]), [1, 1]),
    )
  })

  it('A3 moves a tab that is already open into the new pane and does not leave a second copy', () => {
    const layout = deepFreeze(layoutOf(row([pane(0, tab('a'), tab('c')), single('b')], [LEFT, FR]), [0]))

    const next = openBeside(layout, { blockId: 'c' }, place('b', 'bottom'), BLOCKS)

    expect(next).toEqual(layoutOf(row([single('a'), col([single('b'), single('c')], [FR, FR])], [LEFT, FR]), [1, 1]))
    expect(tabsMatching(next, 'c', '')).toBe(1)
  })

  it('A3 moves one multiInstance content beside the tab and leaves the other content where it was', () => {
    const layout = deepFreeze(layoutOf(row([pane(0, tab('m', 'x'), tab('m', 'y')), single('b')], [LEFT, FR]), [1]))

    const next = openBeside(layout, { blockId: 'm', contentId: 'y' }, place('b', 'left'), BLOCKS)

    expect(next).toEqual(
      layoutOf(row([pane(0, tab('m', 'x')), row([single('m', 'y'), single('b')], [FR, FR])], [LEFT, FR]), [1, 0]),
    )
    expect(tabsMatching(next, 'm', 'y')).toBe(1)
    expect(tabsMatching(next, 'm', 'x')).toBe(1)
  })

  it('A3 returns the same layout when the beside block is not registered or its tab is not open', () => {
    const layout = deepFreeze(layoutOf(row([single('ghost'), single('a')], [LEFT, FR]), [1]))
    expect(openBeside(layout, { blockId: 'b' }, place('ghost', 'left'), BLOCKS)).toBe(layout)
    expect(openBeside(layout, { blockId: 'b' }, place('c', 'right'), BLOCKS)).toBe(layout)

    const empty = emptyLayout()
    expect(openBeside(empty, { blockId: 'b' }, place('a', 'top'), BLOCKS)).toBe(empty)

    const multi = deepFreeze(layoutOf(pane(0, tab('m', 'x'))))
    expect(openBeside(multi, { blockId: 'b' }, place('m', 'bottom', 'y'), BLOCKS)).toBe(multi)
  })
})
