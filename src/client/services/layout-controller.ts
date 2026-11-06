/** Holds the layout the dock draws: starts from the registry's first preset and follows registry changes. */
import type {
  BlockLayoutActions,
  BlockMeta,
  BlockRef,
  BlockTarget,
  CloseGuard,
  Disposer,
  LayoutActionRejection,
  LayoutActionResult,
  LayoutNode,
  LayoutPane,
  LayoutSize,
  LayoutView,
  LocalizedText,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { chooseLayout, clampSize, nodeAt, replaceAt, resolveLayout, type LayoutCatalog } from '../../lib/layout.ts'
import {
  EMPTY_LAYOUT_HISTORY,
  recordLayout,
  stepBack,
  stepForward,
  type LayoutHistory,
  type LayoutHistoryStep,
} from '../../lib/layout-history.ts'
import { activateBlock, closeBlock, openBeside, openBlock, resizeBlock, tabPathOf } from '../../lib/layout-ops.ts'
import type { BlockRegistration, BlockRegistry } from './block-registry.ts'
import { LOG_PREFIX } from './log-prefix.ts'

/** The key of a tab in `DockSnapshot.titles`. */
export function tabKey(ref: BlockRef): string {
  return `${ref.blockId}\u0000${ref.contentId}`
}

/** What the dock renders: the layout tree, the blocks registered right now and the titles tabs gave themselves. */
export interface DockSnapshot {
  layout: WebuiLayout
  blocks: readonly BlockRegistration[]
  /** Tab titles by `tabKey`, replacing the block's title for that tab. A controller sets it only for tabs in `layout`. */
  titles: ReadonlyMap<string, LocalizedText>
}

/** What the dock itself can do to the layout beyond what blocks are given. */
export interface DockActions extends BlockLayoutActions {
  /** Replaces the sizes of the split at `path` (child indices from the root); ignored when it is no split or the count differs. */
  resizeSplit(path: readonly number[], sizes: readonly LayoutSize[]): void
  /** Starts a drag gesture: until `endResize`, `resizeSplit` publishes the layout but `onAction` listeners hear nothing. */
  beginResize(): void
  /** Ends the gesture; when the layout differs from the one `onAction` listeners last heard (or the one at `beginResize`), each hears it once. */
  endResize(): void
  /**
   * Titles the tab `ref`, or restores the block's title with `null`. Ignored when `ref` is no tab in the layout
   * and when the title is unchanged. Not a user action: `onAction` listeners hear nothing and nothing is saved.
   */
  setTabTitle(ref: BlockRef, title: LocalizedText | null): void
  /**
   * Sets the guard of the tab `ref` (replacing any earlier one), or removes it with `null`. Ignored when `ref` is no tab
   * in the layout. Only `close` and `resetToPreset` ask it; it is dropped with the tab. Not a user action: nothing is
   * published, `onAction` listeners hear nothing and nothing is saved.
   */
  setCloseGuard(ref: BlockRef, guard: CloseGuard | null): void
}

/** Every tab key in the layout. */
function tabKeysOf(node: LayoutNode | null, keys = new Set<string>()): Set<string> {
  if (node === null) return keys
  if (node.kind === 'pane') for (const ref of node.tabs) keys.add(tabKey(ref))
  else for (const child of node.children) tabKeysOf(child, keys)
  return keys
}

/** Whether two texts hold the same languages with the same strings. */
function sameText(a: LocalizedText, b: LocalizedText): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
}

/** The layout with the sizes of the split at `path` replaced; the same layout when no split there fits `sizes`. */
function resizeSplitAt(layout: WebuiLayout, path: readonly number[], sizes: readonly LayoutSize[]): WebuiLayout {
  const { root } = layout
  const target = root === null ? undefined : nodeAt(root, path)
  if (root === null || target?.kind !== 'split' || target.children.length !== sizes.length) return layout
  const next = replaceAt(root, path, (at) => (at.kind === 'split' ? { ...at, sizes: sizes.map(clampSize) } : at))
  return { ...layout, root: next }
}

/** Whether two plain data trees (objects, arrays, primitives) hold the same data. */
function sameData(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameData(item, b[i]))
  }
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    const keys = Object.keys(left)
    return (
      keys.length === Object.keys(right).length &&
      keys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]))
    )
  }
  return Object.is(a, b)
}

/**
 * `value` deeply frozen. A node that is not frozen yet is copied rather than frozen in place, so an object a contributor
 * handed over (a preset's layout) never becomes frozen behind its back; a subtree that is frozen all the way down is kept.
 */
function frozenDeep<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  if (Array.isArray(value)) {
    const items: unknown[] = value.map(frozenDeep)
    const kept = Object.isFrozen(value) && items.every((item, i) => item === (value as unknown[])[i])
    return (kept ? value : Object.freeze(items)) as T
  }
  const source = value as Record<string, unknown>
  const entries = Object.entries(source).map(([key, item]) => [key, frozenDeep(item)] as const)
  const kept = Object.isFrozen(value) && entries.every(([key, item]) => item === source[key])
  return (kept ? value : Object.freeze(Object.fromEntries(entries))) as T
}

/** The layout of one page, as an observable snapshot the injected `useDock` hook reads. */
export class LayoutController {
  readonly #registry: BlockRegistry
  readonly #listeners = new Set<() => void>()
  readonly #actionListeners = new Set<(layout: WebuiLayout) => void>()
  readonly #viewListeners = new Set<() => void>()
  #snapshot: DockSnapshot
  #settled = false
  /** True until the layout is first set by an action or a saved layout: until then it follows the presets. */
  #following = true
  /** The layout `onAction` listeners last heard during the open resize gesture (the one at its start until an action notifies); null outside a gesture. */
  #gesture: WebuiLayout | null = null
  /** Close guards by `tabKey`; only tabs in the layout have one. */
  #guards = new Map<string, CloseGuard>()
  /** The layouts the user can step back to and forward to; only user actions record into it, and it lives and dies with the page. */
  #history: LayoutHistory = EMPTY_LAYOUT_HISTORY

  readonly actions: DockActions = {
    open: (target, placement) =>
      this.#act(
        (layout, catalog) => {
          if (!catalog.blocks.has(target.blockId)) return 'unknown-block'
          if (placement === undefined) return undefined
          if (!catalog.blocks.has(placement.beside.blockId)) return 'unknown-block'
          return tabPathOf(layout, placement.beside, catalog) === undefined ? 'no-such-tab' : undefined
        },
        (layout, catalog) =>
          placement === undefined ? openBlock(layout, target, catalog) : openBeside(layout, target, placement, catalog),
      ),
    close: (target) =>
      this.#act(
        (layout, catalog) => {
          const meta = catalog.blocks.get(target.blockId)
          if (meta === undefined) return 'unknown-block'
          if (meta.closable === false) return 'not-closable'
          if (tabPathOf(layout, target, catalog) === undefined) return 'no-such-tab'
          return this.#allows(this.#guardKey(target, catalog)) ? undefined : 'vetoed'
        },
        (layout, catalog) => closeBlock(layout, target, catalog),
      ),
    activate: (target) =>
      this.#act(
        (layout, catalog) => {
          if (!catalog.blocks.has(target.blockId)) return 'unknown-block'
          return tabPathOf(layout, target, catalog) === undefined ? 'no-such-tab' : undefined
        },
        (layout, catalog) => activateBlock(layout, this.#singled(target, catalog)),
      ),
    resize: (target, size: LayoutSize) =>
      this.#act(
        (layout, catalog) => {
          if (!catalog.blocks.has(target.blockId)) return 'unknown-block'
          const path = tabPathOf(layout, target, catalog)
          if (path === undefined) return 'no-such-tab'
          return path.length === 0 ? 'not-in-split' : undefined
        },
        (layout, catalog) => resizeBlock(layout, this.#singled(target, catalog), size),
      ),
    resetToPreset: () =>
      this.#act(
        (layout, catalog) => {
          const kept = tabKeysOf(this.#adopt(undefined, catalog).root)
          for (const key of tabKeysOf(layout.root)) if (!kept.has(key) && !this.#allows(key)) return 'vetoed'
          return undefined
        },
        (_layout, catalog) => this.#adopt(undefined, catalog),
      ),
    undo: () => this.#step(stepBack),
    redo: () => this.#step(stepForward),
    resizeSplit: (path, sizes) => this.#update((layout) => resizeSplitAt(layout, path, sizes), true),
    beginResize: () => {
      this.#gesture ??= this.#snapshot.layout
    },
    endResize: () => {
      const began = this.#gesture
      if (began === null) return
      this.#gesture = null
      const layout = this.#snapshot.layout
      if (layout === began) return
      if (!sameData(began, layout)) this.#setHistory(recordLayout(this.#history, began))
      this.#notify(layout)
    },
    setTabTitle: (ref, title) => {
      const { blocks, layout, titles } = this.#snapshot
      const key = tabKey(ref)
      const current = titles.get(key)
      if (title === null) {
        if (current === undefined) return
      } else if ((current !== undefined && sameText(current, title)) || !tabKeysOf(layout.root).has(key)) {
        return
      }
      const next = new Map(titles)
      if (title === null) next.delete(key)
      else next.set(key, { ...title })
      this.#publish({ layout, blocks, titles: next })
    },
    setCloseGuard: (ref, guard) => {
      const { blocks, layout } = this.#snapshot
      const key = this.#guardKey(ref, this.#catalogOf(blocks))
      if (guard === null) this.#guards.delete(key)
      else if (tabKeysOf(layout.root).has(key)) this.#guards.set(key, guard)
    },
  }

  /** The read-only face of the layout handed to every block; one object for the controller's whole life. */
  readonly view: LayoutView = {
    getSnapshot: () => this.#snapshot.layout,
    subscribe: (listener): Disposer => {
      this.#viewListeners.add(listener)
      return () => {
        this.#viewListeners.delete(listener)
      }
    },
    isOpen: (target) => this.#tabOf(target) !== undefined,
    isActive: (target) => {
      const tab = this.#tabOf(target)
      return tab !== undefined && tab.pane.tabs[tab.pane.active] === tab.ref
    },
    canUndo: () => this.#history.past.length > 0,
    canRedo: () => this.#history.future.length > 0,
  }

  constructor(registry: BlockRegistry) {
    this.#registry = registry
    const blocks = registry.blocks()
    this.#snapshot = {
      layout: frozenDeep(this.#adopt(undefined, this.#catalogOf(blocks))),
      blocks,
      titles: new Map(),
    }
    registry.subscribe(() => {
      const next = registry.blocks()
      const catalog = this.#catalogOf(next)
      const layout = this.#following
        ? this.#adopt(undefined, catalog)
        : resolveLayout(this.#snapshot.layout, catalog).layout
      this.#publish({ layout, blocks: next, titles: this.#snapshot.titles })
    })
  }

  getSnapshot(): DockSnapshot {
    return this.#snapshot
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Whether every block that will register has; until then a layout keeps the blocks that are not registered yet. */
  get settled(): boolean {
    return this.#settled
  }

  /**
   * Mark every block as registered and re-resolve the current layout, dropping the blocks that still are not.
   * Not a user action: the layout keeps following presets and no `onAction` listener hears it.
   */
  settle(): void {
    if (this.#settled) return
    this.#settled = true
    const { blocks, layout, titles } = this.#snapshot
    const resolved = resolveLayout(layout, this.#catalogOf(blocks))
    if (resolved.repaired) this.#publish({ layout: resolved.layout, blocks, titles })
  }

  /**
   * Observe the layout changes the user made through `actions`.
   * @param listener - called once after each action that changed the layout, with the new layout.
   * @returns the disposer removing the listener.
   */
  onAction(listener: (layout: WebuiLayout) => void): () => void {
    this.#actionListeners.add(listener)
    return () => {
      this.#actionListeners.delete(listener)
    }
  }

  /**
   * Adopt a layout loaded from storage, repaired against the registered blocks.
   * @param saved - the stored value, of unknown shape.
   * @param settled - whether every block that will register has; only then are unknown blocks dropped.
   */
  replaceLayout(saved: unknown, settled: boolean): void {
    this.#settled = settled
    this.#following = false
    const blocks = this.#registry.blocks()
    this.#publish(
      { layout: this.#adopt(saved, this.#catalogOf(blocks)), blocks, titles: this.#snapshot.titles },
      EMPTY_LAYOUT_HISTORY,
    )
  }

  /** The tab `target` names in the current layout, with the pane holding it; undefined when it is not open or its block is not registered. */
  #tabOf(target: BlockTarget): { ref: BlockRef; pane: LayoutPane } | undefined {
    const { blocks, layout } = this.#snapshot
    const catalog = this.#catalogOf(blocks)
    if (layout.root === null || !catalog.blocks.has(target.blockId)) return undefined
    const path = tabPathOf(layout, target, catalog)
    const pane = path === undefined ? undefined : nodeAt(layout.root, path)
    if (pane?.kind !== 'pane') return undefined
    const { blockId, contentId } = this.#singled(target, catalog)
    const ref = pane.tabs.find((tab) => tab.blockId === blockId && tab.contentId === (contentId ?? ''))
    return ref === undefined ? undefined : { ref, pane }
  }

  #catalogOf(blocks: readonly BlockRegistration[]): LayoutCatalog {
    return { blocks: new Map(blocks.map((block) => [block.meta.id, block.meta])), settled: this.#settled }
  }

  #adopt(saved: unknown, catalog: LayoutCatalog): WebuiLayout {
    return chooseLayout(saved, this.#registry.presets(), catalog).layout
  }

  /** The pure activate / resize match a tab exactly, so a single-instance block's contentId is dropped here. */
  #singled(target: BlockTarget, catalog: LayoutCatalog): BlockTarget {
    const meta: BlockMeta | undefined = catalog.blocks.get(target.blockId)
    return meta !== undefined && !meta.multiInstance ? { blockId: target.blockId, contentId: '' } : target
  }

  /** The `tabKey` of the tab `target` names: a single-instance block has no contentId of its own. */
  #guardKey(target: BlockTarget, catalog: LayoutCatalog): string {
    const { blockId, contentId } = this.#singled(target, catalog)
    return tabKey({ blockId, contentId: contentId ?? '' })
  }

  /** Whether the guard of tab `key` lets it close; a guard that throws vetoes, and warns. */
  #allows(key: string): boolean {
    const guard = this.#guards.get(key)
    if (guard === undefined) return true
    try {
      return guard()
    } catch (error) {
      console.warn(
        `${LOG_PREFIX} the close guard of block "${key.split('\u0000')[0]}" threw, so the close is vetoed: ${String(error)}`,
      )
      return false
    }
  }

  /** Judges the request against the current layout first: a rejection touches nothing, an accepted one is applied by `#update`. */
  #act(
    judge: (layout: WebuiLayout, catalog: LayoutCatalog) => LayoutActionRejection | undefined,
    change: (layout: WebuiLayout, catalog: LayoutCatalog) => WebuiLayout,
  ): LayoutActionResult {
    const reason = judge(this.#snapshot.layout, this.#catalogOf(this.#snapshot.blocks))
    if (reason !== undefined) return { ok: false, reason }
    this.#update(change)
    return { ok: true }
  }

  #update(change: (layout: WebuiLayout, catalog: LayoutCatalog) => WebuiLayout, deferrable = false): void {
    this.#following = false
    const { blocks, layout, titles } = this.#snapshot
    const next = change(layout, this.#catalogOf(blocks))
    if (next === layout) return
    const announced = !(deferrable && this.#gesture !== null)
    this.#publish(
      { layout: next, blocks, titles },
      announced && !sameData(layout, next) ? recordLayout(this.#history, layout) : this.#history,
    )
    const published = this.#snapshot.layout
    if (!announced) return
    this.#notify(published)
    if (this.#gesture !== null) this.#gesture = published
  }

  /** Undo or redo: lands on the repaired target unless a close guard vetoes a tab it drops; the layout is announced when its object changed. */
  #step(take: (history: LayoutHistory, current: WebuiLayout) => LayoutHistoryStep | undefined): LayoutActionResult {
    const { blocks, layout, titles } = this.#snapshot
    const step = take(this.#history, layout)
    if (step === undefined) return { ok: false, reason: 'no-history' }
    const target = resolveLayout(step.layout, this.#catalogOf(blocks)).layout
    const kept = tabKeysOf(target.root)
    for (const key of tabKeysOf(layout.root))
      if (!kept.has(key) && !this.#allows(key)) return { ok: false, reason: 'vetoed' }
    this.#following = false
    this.#publish({ layout: target, blocks, titles }, step.history)
    const published = this.#snapshot.layout
    if (published !== layout) {
      this.#notify(published)
      if (this.#gesture !== null) this.#gesture = published
    }
    return { ok: true }
  }

  #notify(layout: WebuiLayout): void {
    for (const listener of [...this.#actionListeners]) listener(layout)
  }

  /**
   * Publishes `snapshot`, dropping the titles and close guards of tabs that are no longer in its layout. The layout is
   * frozen, and a layout holding the data of the current one is replaced by the current object, so the view hears nothing.
   */
  #publish(snapshot: DockSnapshot, history: LayoutHistory = this.#history): void {
    const previous = this.#snapshot.layout
    const stepsBefore = this.#stepsOf()
    this.#history = history
    const layout = sameData(previous, snapshot.layout) ? previous : frozenDeep(snapshot.layout)
    const keys = tabKeysOf(layout.root)
    const kept = [...snapshot.titles].filter(([key]) => keys.has(key))
    this.#snapshot = {
      ...snapshot,
      layout,
      titles: kept.length === snapshot.titles.size ? snapshot.titles : new Map(kept),
    }
    for (const key of [...this.#guards.keys()]) if (!keys.has(key)) this.#guards.delete(key)
    for (const listener of [...this.#listeners]) listener()
    if (layout !== previous || this.#stepsOf() !== stepsBefore) this.#notifyView()
  }

  /** Stores `history`, and tells the view listeners when that changes `canUndo` or `canRedo`. */
  #setHistory(history: LayoutHistory): void {
    const stepsBefore = this.#stepsOf()
    this.#history = history
    if (this.#stepsOf() !== stepsBefore) this.#notifyView()
  }

  /** `canUndo` and `canRedo` as one comparable value. */
  #stepsOf(): number {
    return (this.#history.past.length > 0 ? 1 : 0) + (this.#history.future.length > 0 ? 2 : 0)
  }

  #notifyView(): void {
    for (const listener of [...this.#viewListeners]) listener()
  }
}
