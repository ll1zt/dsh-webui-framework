import type {
  BlockMeta,
  BlockRef,
  LayoutNode,
  LayoutPane,
  LayoutPreset,
  LayoutSize,
  LayoutSplit,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it } from 'vitest'
import type { LayoutCatalog } from './layout.ts'
import { chooseLayout, emptyLayout, resolveLayout } from './layout.ts'

const FR: LayoutSize = { fr: 1 }
const LEFT: LayoutSize = { px: 260, min: 180, max: 480 }

function meta(id: string, over: Partial<BlockMeta> = {}): BlockMeta {
  return { id, scope: 'root', priority: 0, title: { zh: id, en: id }, closable: true, multiInstance: false, ...over }
}

function catalog(settled: boolean, ...blocks: BlockMeta[]): LayoutCatalog {
  return { blocks: new Map(blocks.map((block) => [block.id, block])), settled }
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

const ABC = catalog(true, meta('a'), meta('b'), meta('c'))

describe('emptyLayout', () => {
  it('A1 is a version 1 layout with no root and an empty active path', () => {
    expect(emptyLayout()).toEqual({ version: 1, root: null, activePane: [] })
  })
})

describe('resolveLayout', () => {
  it.each([
    ['null', null],
    ['a string', 'garbage'],
    ['version 2', { version: 2, root: null, activePane: [] }],
    ['a node of no known kind', { version: 1, root: { kind: 'tabs' }, activePane: [] }],
    [
      'children and sizes of different length',
      { version: 1, root: row([single('a'), single('b')], [LEFT]), activePane: [0] },
    ],
  ])('A1 returns the empty layout, repaired, for %s', (_name, saved) => {
    const result = resolveLayout(saved, ABC)
    expect(result.layout).toEqual(emptyLayout())
    expect(result.repaired).toBe(true)
  })

  it('A1 passes a valid layout through unchanged and not repaired', () => {
    const saved = layoutOf(row([col([single('a'), single('b')], [FR, LEFT]), pane(0, tab('c'))], [LEFT, FR]), [1])
    const result = resolveLayout(saved, ABC)
    expect(result.layout).toEqual(saved)
    expect(result.repaired).toBe(false)
  })

  it('A1 passes the empty layout through not repaired', () => {
    const result = resolveLayout(emptyLayout(), ABC)
    expect(result.layout).toEqual(emptyLayout())
    expect(result.repaired).toBe(false)
  })

  it('A2 keeps a tab of an unregistered block in place while the catalog is not settled', () => {
    const saved = layoutOf(row([pane(0, tab('a'), tab('ghost')), single('ghost2')], [LEFT, FR]), [0])
    const result = resolveLayout(saved, catalog(false, meta('a')))
    expect(result.layout).toEqual(saved)
    expect(result.repaired).toBe(false)
  })

  it('A2 drops a tab of an unregistered block once the catalog is settled', () => {
    const saved = layoutOf(row([pane(0, tab('a'), tab('ghost')), single('b')], [LEFT, FR]), [1])
    const result = resolveLayout(saved, catalog(true, meta('a'), meta('b')))
    expect(result.layout).toEqual(layoutOf(row([single('a'), single('b')], [LEFT, FR]), [1]))
    expect(result.repaired).toBe(true)
  })

  it('A2 removes the pane the drop emptied and flattens the split left with one child, keeping its size', () => {
    const saved = layoutOf(row([col([single('a'), single('ghost')], [FR, FR]), single('b')], [LEFT, FR]), [1])
    const result = resolveLayout(saved, catalog(true, meta('a'), meta('b')))
    expect(result.layout).toEqual(layoutOf(row([single('a'), single('b')], [LEFT, FR]), [1]))
    expect(result.repaired).toBe(true)
  })

  it('A2 leaves a root pane when the root split is flattened', () => {
    const saved = layoutOf(row([single('a'), single('ghost')], [LEFT, FR]), [0])
    const result = resolveLayout(saved, catalog(true, meta('a')))
    expect(result.layout).toEqual(layoutOf(single('a'), []))
    expect(result.repaired).toBe(true)
  })

  it('A2 turns a layout of only unregistered blocks into an empty root', () => {
    const saved = layoutOf(row([single('ghost'), single('other')], [LEFT, FR]), [0])
    const result = resolveLayout(saved, catalog(true))
    expect(result.layout).toEqual(emptyLayout())
    expect(result.repaired).toBe(true)
  })

  it.each([
    ['below min', { px: 100, min: 180, max: 480 }, { px: 180, min: 180, max: 480 }],
    ['above max', { px: 9999, min: 180, max: 480 }, { px: 480, min: 180, max: 480 }],
    ['inside the range', { px: 300, min: 180, max: 480 }, { px: 300, min: 180, max: 480 }],
  ])('A3 clamps a px size %s into [min, max]', (_name, given, expected) => {
    const result = resolveLayout(layoutOf(row([single('a'), single('b')], [given, FR]), [0]), ABC)
    expect(result.layout).toEqual(layoutOf(row([single('a'), single('b')], [expected, FR]), [0]))
    expect(result.repaired).toBe(given.px !== expected.px)
  })

  it.each([
    ['a string', 'wide'],
    ['null', null],
    ['NaN px', { px: Number.NaN, min: 1, max: 2 }],
    ['an empty object', {}],
  ])('A3 gives an unusable size (%s) the defaultSize of the pane’s only block', (_name, bad) => {
    const blocks = catalog(true, meta('a', { defaultSize: LEFT }), meta('b'))
    const saved = { version: 1, root: row([single('a'), single('b')], []), activePane: [0] }
    const root = { ...saved.root, sizes: [bad, FR] }
    const result = resolveLayout({ ...saved, root }, blocks)
    expect(result.layout).toEqual(layoutOf(row([single('a'), single('b')], [LEFT, FR]), [0]))
    expect(result.repaired).toBe(true)
  })

  it('A3 gives an unusable size {fr:1} when the block has no defaultSize or the pane holds several blocks', () => {
    const blocks = catalog(true, meta('a', { defaultSize: LEFT }), meta('b'), meta('c', { defaultSize: LEFT }))
    const both = pane(0, tab('a'), tab('c'))
    const saved = { version: 1, root: { ...row([both, single('b')], []), sizes: ['x', 'y'] }, activePane: [0] }
    const result = resolveLayout(saved, blocks)
    expect(result.layout).toEqual(layoutOf(row([both, single('b')], [FR, FR]), [0]))
    expect(result.repaired).toBe(true)
  })

  it.each([
    [5, 1],
    [-1, 0],
  ])('A3 clamps pane.active %d into the tab range (%d)', (active, expected) => {
    const result = resolveLayout(layoutOf(pane(active, tab('a'), tab('b'))), ABC)
    expect(result.layout).toEqual(layoutOf(pane(expected, tab('a'), tab('b'))))
    expect(result.repaired).toBe(true)
  })

  it.each([
    ['out of the tree', [7]],
    ['at a split', []],
    ['below a pane', [0, 0, 0]],
  ])('A3 points an activePane %s at the first pane', (_name, activePane) => {
    const root = row([col([single('a'), single('b')], [FR, FR]), single('c')], [LEFT, FR])
    const result = resolveLayout(layoutOf(root, activePane), ABC)
    expect(result.layout).toEqual(layoutOf(root, [0, 0]))
    expect(result.repaired).toBe(true)
  })

  it('A3 sets activePane to [] when the root is null', () => {
    const result = resolveLayout({ version: 1, root: null, activePane: [3] }, ABC)
    expect(result.layout).toEqual(emptyLayout())
    expect(result.repaired).toBe(true)
  })

  it('A3 makes the contentId of a single-instance block empty', () => {
    const result = resolveLayout(layoutOf(pane(0, tab('a', 'x'))), ABC)
    expect(result.layout).toEqual(layoutOf(single('a')))
    expect(result.repaired).toBe(true)
  })

  it('A3 keeps only the first of a single-instance block that appears twice, across panes too', () => {
    const saved = layoutOf(row([pane(0, tab('a'), tab('b'), tab('a')), single('a')], [LEFT, FR]), [0])
    const result = resolveLayout(saved, ABC)
    expect(result.layout).toEqual(layoutOf(pane(0, tab('a'), tab('b')), []))
    expect(result.repaired).toBe(true)
  })

  it('A3 keeps multiInstance tabs that differ in contentId and drops an exact repeat', () => {
    const blocks = catalog(true, meta('m', { multiInstance: true }))
    const result = resolveLayout(layoutOf(pane(0, tab('m', 'x'), tab('m', 'y'), tab('m', 'x'))), blocks)
    expect(result.layout).toEqual(layoutOf(pane(0, tab('m', 'x'), tab('m', 'y'))))
    expect(result.repaired).toBe(true)
  })

  it('A4 puts a missing closable:false block into a new root pane of an empty layout', () => {
    const blocks = catalog(true, meta('files', { closable: false }))
    const result = resolveLayout(emptyLayout(), blocks)
    expect(result.layout).toEqual(layoutOf(single('files'), []))
    expect(result.repaired).toBe(true)
  })

  it('A4 puts a missing closable:false block into the active pane as a tab', () => {
    const blocks = catalog(true, meta('a'), meta('b'), meta('files', { closable: false }))
    const result = resolveLayout(layoutOf(row([single('a'), single('b')], [LEFT, FR]), [1]), blocks)
    expect(result.layout).toMatchObject({
      activePane: [1],
      root: { children: [{ tabs: [tab('a')] }, { tabs: [tab('b'), tab('files')] }] },
    })
    expect(result.repaired).toBe(true)
  })

  it('A4 leaves a closable:false block alone when it is already in the tree', () => {
    const blocks = catalog(true, meta('a'), meta('files', { closable: false }))
    const saved = layoutOf(pane(0, tab('a'), tab('files')))
    const result = resolveLayout(saved, blocks)
    expect(result.layout).toEqual(saved)
    expect(result.repaired).toBe(false)
  })

  it('A4 does not put back a closable:false block that is multiInstance', () => {
    const blocks = catalog(true, meta('m', { closable: false, multiInstance: true }))
    const result = resolveLayout(emptyLayout(), blocks)
    expect(result.layout).toEqual(emptyLayout())
    expect(result.repaired).toBe(false)
  })
})

describe('chooseLayout', () => {
  const saved = layoutOf(row([single('a'), single('b')], [LEFT, FR]), [0])
  const first: LayoutPreset = { id: 'first', priority: 0, layout: layoutOf(single('c')) }
  const second: LayoutPreset = { id: 'second', priority: 1, layout: layoutOf(single('b')) }

  it('A5 uses the saved layout when it is usable', () => {
    const result = chooseLayout(saved, [first, second], ABC)
    expect(result.layout).toEqual(saved)
    expect(result.repaired).toBe(false)
  })

  it('A5 uses the saved layout after repairing it', () => {
    const withGhost = layoutOf(row([pane(0, tab('a'), tab('ghost')), single('b')], [LEFT, FR]), [0])
    const result = chooseLayout(withGhost, [first], ABC)
    expect(result.layout).toEqual(saved)
    expect(result.repaired).toBe(true)
  })

  it('A5 uses the first preset when nothing was saved', () => {
    expect(chooseLayout(undefined, [first, second], ABC).layout).toEqual(first.layout)
  })

  it.each([
    ['an empty layout', emptyLayout()],
    ['garbage', 'garbage'],
    ['a layout whose blocks are all gone', layoutOf(single('ghost'))],
  ])('A5 uses the first preset when the saved value is %s', (_name, value) => {
    expect(chooseLayout(value, [first, second], ABC).layout).toEqual(first.layout)
  })

  it('A5 repairs the preset it adopts', () => {
    const preset: LayoutPreset = {
      id: 'p',
      priority: 0,
      layout: layoutOf(row([single('a'), single('ghost')], [LEFT, FR]), [0]),
    }
    expect(chooseLayout(undefined, [preset], ABC).layout).toEqual(layoutOf(single('a'), []))
  })

  it.each([
    ['nothing saved', undefined],
    ['garbage saved', 'garbage'],
  ])('A5 returns the empty layout with no presets and %s', (_name, value) => {
    expect(chooseLayout(value, [], ABC).layout).toEqual(emptyLayout())
  })
})
