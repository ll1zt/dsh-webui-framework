import type {
  BlockMeta,
  BlockRef,
  LayoutNode,
  LayoutPane,
  LayoutSize,
  LayoutSplit,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it } from 'vitest'
import type { LayoutCatalog } from './layout.ts'
import { emptyLayout } from './layout.ts'
import { activateBlock, closeBlock, openBlock, resizeBlock } from './layout-ops.ts'
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
const single = (blockId: string): LayoutPane => pane(0, tab(blockId))
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

const BLOCKS = catalog(
  meta('a'),
  meta('b'),
  meta('c'),
  meta('m', { multiInstance: true }),
)

const WITH_PINNED = catalog(meta('a'), meta('pinned', { closable: false }))

describe('openBlock', () => {
  it('A6 builds a single-pane root on the empty layout', () => {
    expect(openBlock(emptyLayout(), { blockId: 'a' }, BLOCKS)).toEqual(layoutOf(single('a'), []))
  })

  it('A6 adds a new tab to the pane at activePane and activates it', () => {
    const layout = layoutOf(row([single('a'), single('b')], [LEFT, FR]), [1])
    expect(openBlock(layout, { blockId: 'c' }, BLOCKS)).toEqual(
      layoutOf(row([single('a'), pane(1, tab('b'), tab('c'))], [LEFT, FR]), [1]),
    )
  })

  it('A6 follows a nested activePane', () => {
    const layout = layoutOf(row([col([single('a'), single('b')], [FR, FR]), single('c')], [LEFT, FR]), [0, 1])
    expect(openBlock(layout, { blockId: 'm', contentId: 'x' }, BLOCKS)).toEqual(
      layoutOf(
        row([col([single('a'), pane(1, tab('b'), tab('m', 'x'))], [FR, FR]), single('c')], [LEFT, FR]),
        [0, 1],
      ),
    )
  })

  it('A6 only activates a block that is already open in the active pane', () => {
    const layout = layoutOf(pane(0, tab('a'), tab('b')))
    expect(openBlock(layout, { blockId: 'b' }, BLOCKS)).toEqual(layoutOf(pane(1, tab('a'), tab('b'))))
  })

  it('A6 only activates a block that is open in another pane, and makes that pane active', () => {
    const layout = layoutOf(row([pane(0, tab('a'), tab('b')), single('c')], [LEFT, FR]), [1])
    expect(openBlock(layout, { blockId: 'b' }, BLOCKS)).toEqual(
      layoutOf(row([pane(1, tab('a'), tab('b')), single('c')], [LEFT, FR]), [0]),
    )
  })

  it('A6 gives a multiInstance block one tab per contentId', () => {
    const once = openBlock(emptyLayout(), { blockId: 'm', contentId: 'x' }, BLOCKS)
    const twice = openBlock(once, { blockId: 'm', contentId: 'y' }, BLOCKS)
    expect(twice).toEqual(layoutOf(pane(1, tab('m', 'x'), tab('m', 'y')), []))
    expect(openBlock(twice, { blockId: 'm', contentId: 'x' }, BLOCKS)).toEqual(
      layoutOf(pane(0, tab('m', 'x'), tab('m', 'y')), []),
    )
  })
})

describe('closeBlock', () => {
  it('A4 returns the layout as it was for a closable:false block', () => {
    const layout = layoutOf(row([single('a'), single('pinned')], [LEFT, FR]), [0])
    expect(closeBlock(layout, { blockId: 'pinned' }, WITH_PINNED)).toBe(layout)
  })

  it('A7 returns the layout as it was for a block that is not open', () => {
    const layout = layoutOf(single('a'))
    expect(closeBlock(layout, { blockId: 'b' }, BLOCKS)).toBe(layout)
  })

  it('A7 returns the layout as it was for a multiInstance contentId that is not open', () => {
    const layout = layoutOf(pane(0, tab('m', 'x')))
    expect(closeBlock(layout, { blockId: 'm', contentId: 'y' }, BLOCKS)).toBe(layout)
  })

  it('A4 removes one tab and keeps the others', () => {
    const layout = layoutOf(pane(1, tab('a'), tab('b')))
    expect(closeBlock(layout, { blockId: 'b' }, BLOCKS)).toEqual(layoutOf(single('a')))
  })

  it('A4 removes only the multiInstance tab with the given contentId', () => {
    const layout = layoutOf(pane(0, tab('m', 'x'), tab('m', 'y')))
    expect(closeBlock(layout, { blockId: 'm', contentId: 'y' }, BLOCKS)).toEqual(layoutOf(pane(0, tab('m', 'x'))))
  })

  it('A4 removes the emptied pane, flattens the split left with one child and repairs activePane', () => {
    const layout = layoutOf(row([col([single('a'), single('b')], [FR, FR]), single('c')], [LEFT, FR]), [0, 1])
    expect(closeBlock(layout, { blockId: 'b' }, BLOCKS)).toEqual(
      layoutOf(row([single('a'), single('c')], [LEFT, FR]), [0]),
    )
  })

  it('A4 leaves the empty layout when the last block is closed', () => {
    expect(closeBlock(layoutOf(single('a')), { blockId: 'a' }, BLOCKS)).toEqual(emptyLayout())
  })
})

describe('activateBlock', () => {
  it('A7 activates the tab and makes its pane the active pane', () => {
    const layout = layoutOf(row([pane(0, tab('a'), tab('b')), single('c')], [LEFT, FR]), [1])
    expect(activateBlock(layout, { blockId: 'b' })).toEqual(
      layoutOf(row([pane(1, tab('a'), tab('b')), single('c')], [LEFT, FR]), [0]),
    )
  })

  it('A7 activates the multiInstance tab with the given contentId', () => {
    const layout = layoutOf(pane(0, tab('m', 'x'), tab('m', 'y')))
    expect(activateBlock(layout, { blockId: 'm', contentId: 'y' })).toEqual(
      layoutOf(pane(1, tab('m', 'x'), tab('m', 'y'))),
    )
  })

  it('A7 returns the layout as it was for a block that is not open', () => {
    const layout = layoutOf(row([single('a'), single('b')], [LEFT, FR]), [0])
    expect(activateBlock(layout, { blockId: 'c' })).toBe(layout)
  })
})

describe('resizeBlock', () => {
  const layout = layoutOf(row([single('a'), pane(0, tab('b'), tab('c'))], [LEFT, FR]), [0])

  it('A7 sets the size of the pane that holds the block within its parent split', () => {
    const size: LayoutSize = { px: 300, min: 180, max: 480 }
    expect(resizeBlock(layout, { blockId: 'a' }, size)).toEqual(
      layoutOf(row([single('a'), pane(0, tab('b'), tab('c'))], [size, FR]), [0]),
    )
    expect(resizeBlock(layout, { blockId: 'c' }, { fr: 3 })).toEqual(
      layoutOf(row([single('a'), pane(0, tab('b'), tab('c'))], [LEFT, { fr: 3 }]), [0]),
    )
  })

  it.each([
    [9999, 480],
    [10, 180],
  ])('A7 clamps a px size of %d into [min, max] (%d)', (px, expected) => {
    expect(resizeBlock(layout, { blockId: 'a' }, { px, min: 180, max: 480 })).toEqual(
      layoutOf(row([single('a'), pane(0, tab('b'), tab('c'))], [{ px: expected, min: 180, max: 480 }, FR]), [0]),
    )
  })

  it('A7 returns the layout as it was for a block that is not open', () => {
    expect(resizeBlock(layout, { blockId: 'm', contentId: 'x' }, { fr: 2 })).toBe(layout)
  })

  it('A7 returns the layout as it was when the block’s pane is the root', () => {
    const root = layoutOf(single('a'))
    expect(resizeBlock(root, { blockId: 'a' }, { fr: 2 })).toBe(root)
  })
})

describe('layout operations', () => {
  it('A7 leaves the input layout untouched', () => {
    const input = deepFreeze(layoutOf(row([col([single('a'), single('b')], [FR, FR]), single('c')], [LEFT, FR]), [0, 1]))
    const before = structuredClone(input)
    openBlock(input, { blockId: 'm', contentId: 'x' }, BLOCKS)
    openBlock(input, { blockId: 'c' }, BLOCKS)
    closeBlock(input, { blockId: 'b' }, BLOCKS)
    closeBlock(input, { blockId: 'a' }, BLOCKS)
    activateBlock(input, { blockId: 'c' })
    resizeBlock(input, { blockId: 'c' }, { fr: 2 })
    resizeBlock(input, { blockId: 'a' }, { px: 1, min: 1, max: 2 })
    expect(input).toEqual(before)
  })

  it('A7 leaves the empty layout untouched when opening on it', () => {
    const input = deepFreeze(emptyLayout())
    openBlock(input, { blockId: 'a' }, BLOCKS)
    expect(input).toEqual({ version: 1, root: null, activePane: [] })
  })
})
