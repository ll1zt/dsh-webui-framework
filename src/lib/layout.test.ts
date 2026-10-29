import { describe, expect, it } from 'vitest'
import type { BlockKind } from './blocks.ts'
import type { LayoutNode, WebuiLayout } from './layout.ts'
import { defaultLayout, resolveLayout } from './layout.ts'

const ALL: ReadonlySet<BlockKind> = new Set<BlockKind>(['sessions', 'files', 'session', 'viewer'])

const LEFT = { px: 260, min: 180, max: 480 }
const FILES = { px: 240, min: 120, max: 600 }
const VIEWER = { px: 480, min: 360, max: 640 }

const ref = (kind: string, contentId = '') => ({ kind, contentId })
const pane = (...kinds: string[]) => ({ kind: 'pane', tabs: kinds.map((kind) => ref(kind)), active: 0 })
const viewerPane = (...ids: string[]) => ({ kind: 'pane', tabs: ids.map((id) => ref('viewer', id)), active: 0 })
const column = (children: unknown[], sizes: unknown[]) => ({ kind: 'split', axis: 'column', children, sizes })
const row = (children: unknown[], sizes: unknown[]) => ({ kind: 'split', axis: 'row', children, sizes })
const layoutOf = (root: unknown) => ({ version: 1, root, floats: [] })

// The default tree rebuilt from literals, with the left column's size replaceable.
const leftColumn = () => column([pane('sessions'), pane('files')], [{ fr: 1 }, FILES])
const withLeftSize = (size: unknown) => layoutOf(row([leftColumn(), pane('session')], [size, { fr: 1 }]))
const withViewer = (size: unknown) =>
  layoutOf(row([leftColumn(), pane('session'), viewerPane('a')], [LEFT, { fr: 1 }, size]))

function refsOf(node: LayoutNode | WebuiLayout): { kind: string; contentId: string }[] {
  if ('version' in node) return refsOf(node.root)
  return node.kind === 'pane' ? [...node.tabs] : node.children.flatMap(refsOf)
}

describe('resolveLayout', () => {
  it('A1 returns the default layout, repaired, for undefined, garbage and unknown versions', () => {
    for (const saved of [undefined, 'garbage', { version: 2 }]) {
      const result = resolveLayout(saved, ALL)
      expect(result.layout).toEqual(defaultLayout())
      expect(result.repaired).toBe(true)
    }
  })

  it('A1 returns the default layout unchanged when it is already valid', () => {
    const result = resolveLayout(defaultLayout(), ALL)
    expect(result.layout).toEqual(defaultLayout())
    expect(result.repaired).toBe(false)
  })

  it('A1 defaultLayout is the pi-web arrangement', () => {
    expect(defaultLayout()).toEqual(layoutOf(row([leftColumn(), pane('session')], [LEFT, { fr: 1 }])))
  })

  it('A2 drops a tab of an unknown kind', () => {
    const saved = layoutOf(
      row(
        [
          column([{ ...pane('sessions'), tabs: [ref('sessions'), ref('nope')] }, pane('files')], [{ fr: 1 }, FILES]),
          pane('session'),
        ],
        [LEFT, { fr: 1 }],
      ),
    )
    const result = resolveLayout(saved, ALL)
    expect(result.layout).toEqual(defaultLayout())
    expect(result.repaired).toBe(true)
  })

  it('A2 merges a pane emptied by the drop and flattens the split, the child inheriting the split size', () => {
    const saved = layoutOf(
      row([column([pane('sessions'), pane('nope')], [{ fr: 1 }, FILES]), pane('session')], [LEFT, { fr: 1 }]),
    )
    const result = resolveLayout(saved, ALL)
    expect(result.layout).toEqual(layoutOf(row([pane('sessions'), pane('session')], [LEFT, { fr: 1 }])))
    expect(result.repaired).toBe(true)
  })

  it('A2 flattens a one-child split elsewhere in the tree and keeps its size', () => {
    const size = { px: 300, min: 200, max: 400 }
    const saved = layoutOf(
      row([leftColumn(), pane('session'), column([viewerPane('a')], [size])], [LEFT, { fr: 1 }, size]),
    )
    const result = resolveLayout(saved, ALL)
    expect(result.layout).toEqual(
      layoutOf(row([leftColumn(), pane('session'), viewerPane('a')], [LEFT, { fr: 1 }, size])),
    )
    expect(result.repaired).toBe(true)
  })

  it('A2 drops an unregistered block: without files the left column is a sessions pane of unchanged width', () => {
    const result = resolveLayout(defaultLayout(), new Set<BlockKind>(['sessions', 'session', 'viewer']))
    expect(result.layout).toEqual(layoutOf(row([pane('sessions'), pane('session')], [LEFT, { fr: 1 }])))
    expect(result.repaired).toBe(true)
  })

  it('A3 puts a missing session block back at its default position', () => {
    const saved = layoutOf(row([leftColumn()], [LEFT]))
    const result = resolveLayout(saved, ALL)
    expect(result.layout).toEqual(defaultLayout())
    expect(result.repaired).toBe(true)
  })

  it('A3 restores session when its tab was replaced by an unknown kind', () => {
    const saved = layoutOf(row([leftColumn(), pane('nope')], [LEFT, { fr: 1 }]))
    const result = resolveLayout(saved, ALL)
    expect(result.layout).toEqual(defaultLayout())
    expect(result.repaired).toBe(true)
  })

  it('A3 restores session next to a surviving viewer without losing the viewer', () => {
    const saved = layoutOf(row([leftColumn(), viewerPane('a')], [LEFT, VIEWER]))
    const result = resolveLayout(saved, ALL)
    const kinds = refsOf(result.layout).map((r) => `${r.kind}:${r.contentId}`)
    expect(kinds.filter((k) => k === 'session:')).toHaveLength(1)
    expect(kinds).toContain('viewer:a')
    expect(result.repaired).toBe(true)
  })

  it('A3 keeps only the first of a single-instance block that appears in two panes', () => {
    const saved = layoutOf(
      row([leftColumn(), { ...pane('session'), tabs: [ref('session'), ref('sessions')] }], [LEFT, { fr: 1 }]),
    )
    const result = resolveLayout(saved, ALL)
    expect(result.layout).toEqual(defaultLayout())
    expect(result.repaired).toBe(true)
  })

  it('A3 keeps viewer instances that differ in contentId', () => {
    const saved = layoutOf(row([leftColumn(), pane('session'), viewerPane('a', 'b')], [LEFT, { fr: 1 }, VIEWER]))
    const result = resolveLayout(saved, ALL)
    expect(refsOf(result.layout).filter((r) => r.kind === 'viewer')).toEqual([ref('viewer', 'a'), ref('viewer', 'b')])
    expect(result.layout).toEqual(saved)
    expect(result.repaired).toBe(false)
  })

  it('A4 clamps the left column px size into [min, max]', () => {
    const low = resolveLayout(withLeftSize({ px: 100, min: 180, max: 480 }), ALL)
    expect(low.layout).toEqual(
      layoutOf(row([leftColumn(), pane('session')], [{ px: 180, min: 180, max: 480 }, { fr: 1 }])),
    )
    expect(low.repaired).toBe(true)
    const high = resolveLayout(withLeftSize({ px: 9999, min: 180, max: 480 }), ALL)
    expect(high.layout).toEqual(
      layoutOf(row([leftColumn(), pane('session')], [{ px: 480, min: 180, max: 480 }, { fr: 1 }])),
    )
    expect(high.repaired).toBe(true)
  })

  it('A4 leaves an in-range left column size alone', () => {
    const size = { px: 300, min: 180, max: 480 }
    const result = resolveLayout(withLeftSize(size), ALL)
    expect(result.layout).toEqual(withLeftSize(size))
    expect(result.repaired).toBe(false)
  })

  it.each([
    ['0', { px: 0, min: 180, max: 480 }],
    ['-50', { px: -50, min: 180, max: 480 }],
    ['NaN', { px: Number.NaN, min: 180, max: 480 }],
    ['min > max', { px: 300, min: 500, max: 200 }],
  ])('A4 falls back to the default left column size for px %s', (_name, size) => {
    const result = resolveLayout(withLeftSize(size), ALL)
    expect(result.layout).toEqual(defaultLayout())
    expect(result.repaired).toBe(true)
  })

  it('A4 falls back to the default size of the files pane when that size is invalid', () => {
    const saved = layoutOf(
      row(
        [column([pane('sessions'), pane('files')], [{ fr: 1 }, { px: -1, min: 1, max: 2 }]), pane('session')],
        [LEFT, { fr: 1 }],
      ),
    )
    const result = resolveLayout(saved, ALL)
    expect(result.layout).toEqual(defaultLayout())
    expect(result.repaired).toBe(true)
  })

  it.each([
    ['non-positive px', { px: -1, min: 1, max: 2 }],
    ['NaN px', { px: Number.NaN, min: 360, max: 640 }],
    ['min > max', { px: 500, min: 640, max: 360 }],
  ])('A4 uses {fr:1} for an invalid size at a position the default layout lacks (%s)', (_name, size) => {
    const result = resolveLayout(withViewer(size), ALL)
    expect(result.layout).toEqual(
      layoutOf(row([leftColumn(), pane('session'), viewerPane('a')], [LEFT, { fr: 1 }, { fr: 1 }])),
    )
    expect(result.repaired).toBe(true)
  })
})
