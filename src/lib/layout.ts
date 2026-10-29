import type { BlockKind } from './blocks.ts'
import { BLOCK_CATALOG } from './blocks.ts'

// The shape mirrors dockkit's LayoutState (split / pane / tabs / floats) one to
// one, but this module stays dockkit-free: what is stored in a profile is this
// format, not the library's (D40).

export interface LayoutPxSize {
  px: number
  min: number
  max: number
}

export interface LayoutFrSize {
  fr: number
}

/** How much of its parent split a child takes: fixed pixels within bounds, or a share of the rest (D42). */
export type LayoutSize = LayoutPxSize | LayoutFrSize

/** One block instance; single-instance blocks have a `contentId` of `''`. */
export interface BlockRef {
  kind: BlockKind
  contentId: string
  title?: string
}

export interface LayoutPane {
  kind: 'pane'
  tabs: BlockRef[]
  active: number
}

export interface LayoutSplit {
  kind: 'split'
  axis: 'row' | 'column'
  children: LayoutNode[]
  sizes: LayoutSize[]
}

export type LayoutNode = LayoutSplit | LayoutPane

export interface WebuiLayout {
  version: 1
  root: LayoutNode
  floats: readonly LayoutPane[]
}

export interface ResolvedLayout {
  layout: WebuiLayout
  /** True when the saved value differed from the layout returned. */
  repaired: boolean
}

const FR_REST: LayoutFrSize = { fr: 1 }

/** Sessions over files on the left, the session on the right. */
export function defaultLayout(): WebuiLayout {
  const single = (kind: BlockKind): LayoutPane => ({ kind: 'pane', tabs: [{ kind, contentId: '' }], active: 0 })
  return {
    version: 1,
    root: {
      kind: 'split',
      axis: 'row',
      children: [
        {
          kind: 'split',
          axis: 'column',
          children: [single('sessions'), single('files')],
          sizes: [{ fr: 1 }, { px: 240, min: 120, max: 600 }],
        },
        single('session'),
      ],
      sizes: [{ px: 260, min: 180, max: 480 }, { fr: 1 }],
    },
    floats: [],
  }
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

function clampSize(size: LayoutSize): LayoutSize {
  return 'px' in size ? { px: Math.min(Math.max(size.px, size.min), size.max), min: size.min, max: size.max } : size
}

/** The size the default layout gives the node at `path` (child indices from the root), if it has one. */
function defaultSizeAt(path: readonly number[]): LayoutSize | undefined {
  let node = defaultLayout().root
  let size: LayoutSize | undefined
  for (const index of path) {
    if (node.kind !== 'split') return undefined
    const child = node.children[index]
    if (child === undefined) return undefined
    size = node.sizes[index]
    node = child
  }
  return size
}

function resolveSize(value: unknown, path: readonly number[]): LayoutSize {
  const size = readSize(value)
  return size === undefined ? (defaultSizeAt(path) ?? FR_REST) : clampSize(size)
}

function instanceKey(ref: BlockRef): string {
  return BLOCK_CATALOG[ref.kind].multiInstance ? `${ref.kind}:${ref.contentId}` : ref.kind
}

function isKnownKind(kind: unknown): kind is BlockKind {
  return typeof kind === 'string' && Object.hasOwn(BLOCK_CATALOG, kind)
}

/** Required blocks stay even when unregistered: the view shows an "unavailable" placeholder in place. */
function isKept(kind: BlockKind, registered: ReadonlySet<BlockKind>): boolean {
  return registered.has(kind) || !BLOCK_CATALOG[kind].closable
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

class Resolver {
  private readonly seen = new Set<string>()
  private readonly kinds = new Set<BlockKind>()

  private readonly registered: ReadonlySet<BlockKind>

  constructor(registered: ReadonlySet<BlockKind>) {
    this.registered = registered
  }

  has(kind: BlockKind): boolean {
    return this.kinds.has(kind)
  }

  /** `path` locates the node in the saved tree; it picks the default size for an unusable one. */
  node(saved: SavedNode, path: readonly number[]): LayoutNode | undefined {
    if (saved.kind === 'pane') return this.pane(saved)
    const kept: { node: LayoutNode; size: LayoutSize }[] = []
    saved.children.forEach((child, index) => {
      const childPath = [...path, index]
      const node = this.node(child, childPath)
      if (node !== undefined) kept.push({ node, size: resolveSize(saved.sizes[index], childPath) })
    })
    const [only, ...rest] = kept
    if (only === undefined) return undefined
    // A lone survivor takes the split's place, and with it the size the parent gave the split.
    if (rest.length === 0) return only.node
    return { kind: 'split', axis: saved.axis, children: kept.map((k) => k.node), sizes: kept.map((k) => k.size) }
  }

  pane(saved: SavedPane): LayoutPane | undefined {
    const tabs: BlockRef[] = []
    let active = 0
    saved.tabs.forEach((raw, index) => {
      // The active tab moves with its block; if it is dropped, the next tab that survives takes over.
      if (index === saved.active) active = tabs.length
      const ref = this.ref(raw)
      if (ref !== undefined) tabs.push(ref)
    })
    if (tabs.length === 0) return undefined
    return { kind: 'pane', tabs, active: Math.min(active, tabs.length - 1) }
  }

  private ref(raw: unknown): BlockRef | undefined {
    if (!isRecord(raw) || !isKnownKind(raw['kind']) || !isKept(raw['kind'], this.registered)) return undefined
    const kind = raw['kind']
    const { contentId, title } = raw
    const ref: BlockRef = {
      kind,
      contentId: BLOCK_CATALOG[kind].multiInstance && typeof contentId === 'string' ? contentId : '',
    }
    if (typeof title === 'string') ref.title = title
    const key = instanceKey(ref)
    if (this.seen.has(key)) return undefined
    this.seen.add(key)
    this.kinds.add(kind)
    return ref
  }
}

/** Puts a missing required block at the slot the default layout gives it, directly under the root row. */
function restoreRequired(root: LayoutNode, kind: BlockKind): LayoutNode {
  const defaults = defaultLayout().root
  const slots = defaults.kind === 'split' ? defaults.children : []
  const index = slots.findIndex((slot) => slot.kind === 'pane' && slot.tabs.some((tab) => tab.kind === kind))
  // A kind the default root row does not hold goes last, with a plain {fr:1}.
  const slot = index >= 0 ? index : slots.length
  const size = (defaults.kind === 'split' ? defaults.sizes[slot] : undefined) ?? FR_REST
  const pane: LayoutPane = { kind: 'pane', tabs: [{ kind, contentId: '' }], active: 0 }
  if (root.kind === 'split' && root.axis === 'row') {
    const at = Math.min(slot, root.children.length)
    return {
      ...root,
      children: root.children.toSpliced(at, 0, pane),
      sizes: root.sizes.toSpliced(at, 0, size),
    }
  }
  // The row was lost (flattened away), so the survivor goes back to the first slot.
  const first = (defaults.kind === 'split' ? defaults.sizes[0] : undefined) ?? FR_REST
  return { kind: 'split', axis: 'row', children: [root, pane], sizes: [first, size] }
}

/** Turns anything that was saved into a layout that can be rendered, and says whether it had to change it. */
export function resolveLayout(saved: unknown, registered: ReadonlySet<BlockKind>): ResolvedLayout {
  const fallback = (): ResolvedLayout => ({ layout: defaultLayout(), repaired: true })
  if (!isRecord(saved) || saved['version'] !== 1 || !isSavedNode(saved['root'])) return fallback()

  const resolver = new Resolver(registered)
  let root = resolver.node(saved['root'], [])
  // Nothing usable survived: start over from the default, minus what is not registered.
  if (root === undefined) return { layout: resolveLayout(defaultLayout(), registered).layout, repaired: true }

  for (const spec of Object.values(BLOCK_CATALOG)) {
    if (!spec.closable && !spec.multiInstance && !resolver.has(spec.kind)) root = restoreRequired(root, spec.kind)
  }
  // Floats are always empty until floating panes are rendered: saved ones are discarded without being
  // resolved, so a block living only there does not count as present and is restored into the root.
  const layout: WebuiLayout = { version: 1, root, floats: [] }
  return { layout, repaired: !sameData(saved, layout) }
}
