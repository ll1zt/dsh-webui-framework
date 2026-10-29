import type { BlockMeta, BlockRef, BlockTarget, LayoutNode, LayoutSize, WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
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

export function openBlock(layout: WebuiLayout, target: BlockTarget, catalog: LayoutCatalog): WebuiLayout {
  const meta = catalog.blocks.get(target.blockId)
  if (meta === undefined) return layout
  const ref = refOf(target, meta)
  const open = layout.root !== null && findTab(layout.root, ref) !== undefined
  return open ? activateBlock(layout, ref) : appendTab(layout, ref)
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
