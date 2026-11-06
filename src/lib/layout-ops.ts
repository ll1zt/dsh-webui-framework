import type {
  BlockMeta,
  BlockRef,
  BlockTarget,
  LayoutNode,
  LayoutPane,
  LayoutSize,
  OpenPlacement,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import type { LayoutCatalog } from './layout.ts'
import { appendTab, clampSize, replaceAt, resolveLayout } from './layout.ts'

interface TabPlace {
  /** Child indices from the root to the pane holding the tab. */
  path: number[]
  index: number
}

/** The tab for `ref`, found by blockId and contentId. */
function findTab(node: LayoutNode, ref: BlockRef, path: number[] = []): TabPlace | undefined {
  if (node.kind === 'pane') {
    const index = node.tabs.findIndex((tab) => tab.blockId === ref.blockId && tab.contentId === ref.contentId)
    return index < 0 ? undefined : { path, index }
  }
  for (const [i, child] of node.children.entries()) {
    const place = findTab(child, ref, [...path, i])
    if (place !== undefined) return place
  }
  return undefined
}

/** A single-instance block has no contentId of its own, whatever the target says. */
function refOf(target: BlockTarget, meta: BlockMeta | undefined): BlockRef {
  const single = meta !== undefined && !meta.multiInstance
  return { blockId: target.blockId, contentId: single ? '' : (target.contentId ?? '') }
}

/** The child indices from the root to the pane holding the tab `target` names (a single-instance block has no contentId); undefined when the layout has no such tab. */
export function tabPathOf(layout: WebuiLayout, target: BlockTarget, catalog: LayoutCatalog): number[] | undefined {
  if (layout.root === null) return undefined
  return findTab(layout.root, refOf(target, catalog.blocks.get(target.blockId)))?.path
}

export function openBlock(layout: WebuiLayout, target: BlockTarget, catalog: LayoutCatalog): WebuiLayout {
  const meta = catalog.blocks.get(target.blockId)
  if (meta === undefined) return layout
  const ref = refOf(target, meta)
  const open = layout.root !== null && findTab(layout.root, ref) !== undefined
  return open ? activateBlock(layout, ref) : appendTab(layout, ref)
}

const EQUAL_SHARE: LayoutSize = { fr: 1 }

function samePath(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((step, index) => step === b[index])
}

/** The tree without the tab at `place`: an emptied pane is dropped, and a split left with one child is flattened away. */
function withoutTab(node: LayoutNode, place: TabPlace): LayoutNode | null {
  const [head, ...rest] = place.path
  if (head === undefined) {
    if (node.kind !== 'pane') return node
    const tabs = node.tabs.filter((_, index) => index !== place.index)
    if (tabs.length === 0) return null
    const active = place.index < node.active ? node.active - 1 : node.active
    return { kind: 'pane', tabs, active: Math.min(active, tabs.length - 1) }
  }
  if (node.kind !== 'split') return node
  const child = node.children[head]
  if (child === undefined) return node
  const updated = withoutTab(child, { path: rest, index: place.index })
  if (updated === null) {
    const children = node.children.filter((_, index) => index !== head)
    const only = children.length === 1 ? children[0] : undefined
    if (only !== undefined) return only
    if (children.length === 0) return null
    return { kind: 'split', axis: node.axis, children, sizes: node.sizes.filter((_, index) => index !== head) }
  }
  return { ...node, children: node.children.map((item, index) => (index === head ? updated : item)) }
}

/** Replaces the pane at `path` with a two-pane split; `before` puts `pane` first. */
function splitPane(
  root: LayoutNode,
  path: readonly number[],
  pane: LayoutPane,
  axis: 'row' | 'column',
  before: boolean,
): LayoutNode {
  return replaceAt(root, path, (at) => {
    if (at.kind !== 'pane') return at
    return {
      kind: 'split',
      axis,
      children: before ? [pane, at] : [at, pane],
      sizes: [EQUAL_SHARE, EQUAL_SHARE],
    }
  })
}

/**
 * Opens `target` in a new pane beside the pane that holds `placement.beside`.
 * `left` and `top` put the new pane first, `right` and `bottom` second; left/right split on a row and top/bottom on a
 * column, and both sides take an equal share. A target that is already open moves into that pane. Returns `layout`
 * itself when the beside block is not registered or its tab is not open.
 */
export function openBeside(
  layout: WebuiLayout,
  target: BlockTarget,
  placement: OpenPlacement,
  catalog: LayoutCatalog,
): WebuiLayout {
  const besideMeta = catalog.blocks.get(placement.beside.blockId)
  if (besideMeta === undefined || layout.root === null) return layout
  const beside = findTab(layout.root, refOf(placement.beside, besideMeta))
  if (beside === undefined) return layout
  const meta = catalog.blocks.get(target.blockId)
  if (meta === undefined) return layout
  const ref = refOf(target, meta)

  const before = placement.side === 'left' || placement.side === 'top'
  const axis = placement.side === 'left' || placement.side === 'right' ? 'row' : 'column'
  // Read the old place before the split: afterwards the new tab is also in the tree, and a tab that shared the
  // beside pane has moved one level down. Every other pane keeps its path.
  const existing = findTab(layout.root, ref)
  const split = splitPane(layout.root, beside.path, { kind: 'pane', tabs: [ref], active: 0 }, axis, before)
  const root =
    existing === undefined
      ? split
      : withoutTab(split, {
          path: samePath(existing.path, beside.path) ? [...beside.path, before ? 1 : 0] : existing.path,
          index: existing.index,
        })
  if (root === null) return layout
  const placed = findTab(root, ref)
  if (placed === undefined) return layout
  return { version: 1, root, activePane: placed.path }
}

export function closeBlock(layout: WebuiLayout, target: BlockTarget, catalog: LayoutCatalog): WebuiLayout {
  const meta = catalog.blocks.get(target.blockId)
  const { root } = layout
  if (root === null || meta?.closable === false) return layout
  const place = findTab(root, refOf(target, meta))
  if (place === undefined) return layout
  const next = replaceAt(root, place.path, (at) =>
    at.kind === 'pane'
      ? {
          kind: 'pane',
          tabs: at.tabs.filter((_tab, i) => i !== place.index),
          active: place.index < at.active ? at.active - 1 : at.active,
        }
      : at,
  )
  return resolveLayout({ ...layout, root: next }, catalog).layout
}

export function activateBlock(layout: WebuiLayout, target: BlockTarget): WebuiLayout {
  const { root } = layout
  if (root === null) return layout
  const place = findTab(root, { blockId: target.blockId, contentId: target.contentId ?? '' })
  if (place === undefined) return layout
  const next = replaceAt(root, place.path, (at) => (at.kind === 'pane' ? { ...at, active: place.index } : at))
  return { version: 1, root: next, activePane: place.path }
}

export function resizeBlock(layout: WebuiLayout, target: BlockTarget, size: LayoutSize): WebuiLayout {
  const { root } = layout
  if (root === null) return layout
  const place = findTab(root, { blockId: target.blockId, contentId: target.contentId ?? '' })
  const slot = place?.path.at(-1)
  if (place === undefined || slot === undefined) return layout
  const sized = clampSize(size)
  const next = replaceAt(root, place.path.slice(0, -1), (at) =>
    at.kind === 'split' ? { ...at, sizes: at.sizes.map((old, i) => (i === slot ? sized : old)) } : at,
  )
  return { ...layout, root: next }
}
