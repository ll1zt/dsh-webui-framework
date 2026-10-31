import type {
  BlockMeta,
  BlockRef,
  LayoutNode,
  LayoutPane,
  LayoutPreset,
  LayoutSize,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'

// The shape mirrors dockkit's LayoutState (split / pane / tabs) one to one, but this module stays
// dockkit-free: what is stored in a profile is the contract's format, not the library's (D40).

/** The blocks registered right now; `settled` says whether late registrations can still arrive. */
export interface LayoutCatalog {
  blocks: ReadonlyMap<string, BlockMeta>
  settled: boolean
}

export interface ResolvedLayout {
  layout: WebuiLayout
  /** True when the layout returned differs from the value it was made from. */
  repaired: boolean
}

const FR_REST: LayoutSize = { fr: 1 }

export function emptyLayout(): WebuiLayout {
  return { version: 1, root: null, activePane: [] }
}

// What a saved value looks like once its structure is checked; the contents of
// tabs, sizes and `active` are still unknown and are judged by the resolver.
interface SavedPane {
  kind: 'pane'
  tabs: unknown[]
  active: unknown
}

interface SavedSplit {
  kind: 'split'
  axis: 'row' | 'column'
  children: SavedNode[]
  sizes: unknown[]
}

type SavedNode = SavedSplit | SavedPane

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSavedPane(value: unknown): value is SavedPane {
  return isRecord(value) && value['kind'] === 'pane' && Array.isArray(value['tabs'])
}

function isSavedNode(value: unknown): value is SavedNode {
  if (isSavedPane(value)) return true
  if (!isRecord(value) || value['kind'] !== 'split') return false
  const { axis, children, sizes } = value
  return (
    (axis === 'row' || axis === 'column') &&
    Array.isArray(children) &&
    Array.isArray(sizes) &&
    children.length === sizes.length &&
    children.every(isSavedNode)
  )
}

function isIndexPath(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isInteger(item))
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** A size that is usable as-is, except that a px size may still lie outside its own bounds. */
function readSize(value: unknown): LayoutSize | undefined {
  if (!isRecord(value)) return undefined
  const { fr, px, min, max } = value
  if (isPositiveFinite(fr)) return { fr }
  if (!isPositiveFinite(px) || typeof min !== 'number' || typeof max !== 'number') return undefined
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min > max) return undefined
  return { px, min, max }
}

export function clampSize(size: LayoutSize): LayoutSize {
  return 'px' in size ? { px: Math.min(Math.max(size.px, size.min), size.max), min: size.min, max: size.max } : size
}

/** An unusable size becomes the defaultSize of the only block in the pane, else a plain share. */
function resolveSize(value: unknown, node: LayoutNode, catalog: LayoutCatalog): LayoutSize {
  const size = readSize(value)
  if (size !== undefined) return clampSize(size)
  const [only, ...others] = node.kind === 'pane' ? node.tabs : []
  const preferred = only !== undefined && others.length === 0 ? catalog.blocks.get(only.blockId)?.defaultSize : undefined
  const fallback = readSize(preferred)
  return fallback === undefined ? FR_REST : clampSize(fallback)
}

function instanceKey(ref: BlockRef): string {
  return JSON.stringify([ref.blockId, ref.contentId])
}

function sameData(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameData(item, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameData(a[key], b[key]))
    )
  }
  return Object.is(a, b)
}

/** `seen` collects the instances kept so far, so a later repeat of one is dropped. */
function resolveRef(raw: unknown, catalog: LayoutCatalog, seen: Set<string>): BlockRef | undefined {
  if (!isRecord(raw) || typeof raw['blockId'] !== 'string') return undefined
  const blockId = raw['blockId']
  const meta = catalog.blocks.get(blockId)
  // Until the catalog is settled an unknown block may still register: its tab keeps its place.
  if (meta === undefined && catalog.settled) return undefined
  const { contentId } = raw
  const ref: BlockRef = {
    blockId,
    contentId: (meta !== undefined && !meta.multiInstance) || typeof contentId !== 'string' ? '' : contentId,
  }
  const key = instanceKey(ref)
  if (seen.has(key)) return undefined
  seen.add(key)
  return ref
}

function resolvePane(saved: SavedPane, catalog: LayoutCatalog, seen: Set<string>): LayoutPane | undefined {
  const wanted = Number.isInteger(saved.active) ? Math.min(Math.max(saved.active as number, 0), saved.tabs.length - 1) : 0
  const tabs: BlockRef[] = []
  let active = 0
  saved.tabs.forEach((raw, index) => {
    // The active tab moves with its block; if it is dropped, the next tab that survives takes over.
    if (index === wanted) active = tabs.length
    const ref = resolveRef(raw, catalog, seen)
    if (ref !== undefined) tabs.push(ref)
  })
  if (tabs.length === 0) return undefined
  return { kind: 'pane', tabs, active: Math.min(active, tabs.length - 1) }
}

function resolveNode(saved: SavedNode, catalog: LayoutCatalog, seen: Set<string>): LayoutNode | undefined {
  if (saved.kind === 'pane') return resolvePane(saved, catalog, seen)
  const kept: { node: LayoutNode; size: LayoutSize }[] = []
  saved.children.forEach((child, index) => {
    const node = resolveNode(child, catalog, seen)
    if (node !== undefined) kept.push({ node, size: resolveSize(saved.sizes[index], node, catalog) })
  })
  const [only, ...rest] = kept
  if (only === undefined) return undefined
  // A lone survivor takes the split's place, and with it the size the parent gave the split.
  if (rest.length === 0) return only.node
  return { kind: 'split', axis: saved.axis, children: kept.map((k) => k.node), sizes: kept.map((k) => k.size) }
}

/** The node at `path` (child indices from `root`); `root` for `[]`, undefined when the path runs through a pane or off the end. */
export function nodeAt(root: LayoutNode, path: readonly number[]): LayoutNode | undefined {
  let node: LayoutNode | undefined = root
  for (const index of path) {
    if (node?.kind !== 'split') return undefined
    node = node.children[index]
  }
  return node
}

function firstPanePath(root: LayoutNode): number[] {
  const path: number[] = []
  let node = root
  while (node.kind === 'split') {
    const child = node.children[0]
    if (child === undefined) break
    path.push(0)
    node = child
  }
  return path
}

/** The active pane path as is when it points at a pane, else the path of the first pane. */
function repairActivePane(root: LayoutNode | null, path: unknown): number[] {
  if (root === null) return []
  return isIndexPath(path) && nodeAt(root, path)?.kind === 'pane' ? [...path] : firstPanePath(root)
}

/** Rebuilds `node` with the node at `path` (child indices) replaced by `update` of it. */
export function replaceAt(node: LayoutNode, path: readonly number[], update: (at: LayoutNode) => LayoutNode): LayoutNode {
  const [head, ...rest] = path
  if (head === undefined) return update(node)
  if (node.kind !== 'split') return node
  return { ...node, children: node.children.map((child, i) => (i === head ? replaceAt(child, rest, update) : child)) }
}

/** Opens `ref` as a new tab of the active pane and activates it; with no pane yet, as a new root pane. */
export function appendTab(layout: WebuiLayout, ref: BlockRef): WebuiLayout {
  const { root } = layout
  if (root === null) return { version: 1, root: { kind: 'pane', tabs: [ref], active: 0 }, activePane: [] }
  const activePane = repairActivePane(root, layout.activePane)
  const next = replaceAt(root, activePane, (at) =>
    at.kind === 'pane' ? { kind: 'pane', tabs: [...at.tabs, ref], active: at.tabs.length } : at,
  )
  return { version: 1, root: next, activePane }
}

/** Turns anything that was saved into a layout that can be rendered, and says whether it had to change it. */
export function resolveLayout(saved: unknown, catalog: LayoutCatalog): ResolvedLayout {
  if (!isRecord(saved) || saved['version'] !== 1) return { layout: emptyLayout(), repaired: true }
  const savedRoot = saved['root']
  if (savedRoot !== null && !isSavedNode(savedRoot)) return { layout: emptyLayout(), repaired: true }

  const seen = new Set<string>()
  const root = savedRoot === null ? null : (resolveNode(savedRoot, catalog, seen) ?? null)
  let layout: WebuiLayout = { version: 1, root, activePane: repairActivePane(root, saved['activePane']) }

  // A block that cannot be closed must be on screen, so a missing one is opened where a new block would go.
  for (const meta of catalog.blocks.values()) {
    if (meta.closable || meta.multiInstance || seen.has(instanceKey({ blockId: meta.id, contentId: '' }))) continue
    layout = appendTab(layout, { blockId: meta.id, contentId: '' })
  }
  return { layout, repaired: !sameData(saved, layout) }
}

/**
 * The layout to start from: the saved one, else the first preset (the caller sorted them), else the
 * empty layout, each repaired. `repaired` compares with the saved value, or with the source when
 * nothing was saved.
 */
export function chooseLayout(saved: unknown, presets: readonly LayoutPreset[], catalog: LayoutCatalog): ResolvedLayout {
  if (saved !== undefined) {
    const resolved = resolveLayout(saved, catalog)
    if (resolved.layout.root !== null) return resolved
  }
  const source: unknown = presets[0]?.layout ?? emptyLayout()
  const resolved = resolveLayout(source, catalog)
  return saved === undefined ? resolved : { layout: resolved.layout, repaired: !sameData(saved, resolved.layout) }
}
