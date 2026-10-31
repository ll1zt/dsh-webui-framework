/** Holds the layout the dock draws: starts from the registry's first preset and follows registry changes. */
import type {
  BlockLayoutActions,
  BlockMeta,
  BlockTarget,
  LayoutSize,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { chooseLayout, clampSize, nodeAt, replaceAt, resolveLayout, type LayoutCatalog } from '../../lib/layout.ts'
import { activateBlock, closeBlock, openBlock, resizeBlock } from '../../lib/layout-ops.ts'
import type { BlockRegistration, BlockRegistry } from './block-registry.ts'

/** What the dock renders: the layout tree and the blocks registered right now. */
export interface DockSnapshot {
  layout: WebuiLayout
  blocks: readonly BlockRegistration[]
}

/** What the dock itself can do to the layout beyond what blocks are given. */
export interface DockActions extends BlockLayoutActions {
  /** Replaces the sizes of the split at `path` (child indices from the root); ignored when it is no split or the count differs. */
  resizeSplit(path: readonly number[], sizes: readonly LayoutSize[]): void
  /** Starts a drag gesture: until `endResize`, `resizeSplit` publishes the layout but `onAction` listeners hear nothing. */
  beginResize(): void
  /** Ends the gesture; when the layout differs from the one `onAction` listeners last heard (or the one at `beginResize`), each hears it once. */
  endResize(): void
}

/** The layout with the sizes of the split at `path` replaced; the same layout when no split there fits `sizes`. */
function resizeSplitAt(layout: WebuiLayout, path: readonly number[], sizes: readonly LayoutSize[]): WebuiLayout {
  const { root } = layout
  const target = root === null ? undefined : nodeAt(root, path)
  if (root === null || target?.kind !== 'split' || target.children.length !== sizes.length) return layout
  const next = replaceAt(root, path, (at) => (at.kind === 'split' ? { ...at, sizes: sizes.map(clampSize) } : at))
  return { ...layout, root: next }
}

/** The layout of one page, as an observable snapshot the injected `useDock` hook reads. */
export class LayoutController {
  readonly #registry: BlockRegistry
  readonly #listeners = new Set<() => void>()
  readonly #actionListeners = new Set<(layout: WebuiLayout) => void>()
  #snapshot: DockSnapshot
  #settled = false
  /** True until the layout is first set by an action or a saved layout: until then it follows the presets. */
  #following = true
  /** The layout `onAction` listeners last heard during the open resize gesture (the one at its start until an action notifies); null outside a gesture. */
  #gesture: WebuiLayout | null = null

  readonly actions: DockActions = {
    open: (target) => this.#update((layout, catalog) => openBlock(layout, target, catalog)),
    close: (target) => this.#update((layout, catalog) => closeBlock(layout, target, catalog)),
    activate: (target) => this.#update((layout, catalog) => activateBlock(layout, this.#singled(target, catalog))),
    resize: (target, size: LayoutSize) =>
      this.#update((layout, catalog) => resizeBlock(layout, this.#singled(target, catalog), size)),
    resetToPreset: () => this.#update((_layout, catalog) => this.#adopt(undefined, catalog)),
    resizeSplit: (path, sizes) => this.#update((layout) => resizeSplitAt(layout, path, sizes), true),
    beginResize: () => {
      this.#gesture ??= this.#snapshot.layout
    },
    endResize: () => {
      const began = this.#gesture
      if (began === null) return
      this.#gesture = null
      const layout = this.#snapshot.layout
      if (layout !== began) this.#notify(layout)
    },
  }

  constructor(registry: BlockRegistry) {
    this.#registry = registry
    const blocks = registry.blocks()
    this.#snapshot = { layout: this.#adopt(undefined, this.#catalogOf(blocks)), blocks }
    registry.subscribe(() => {
      const next = registry.blocks()
      const catalog = this.#catalogOf(next)
      const layout = this.#following
        ? this.#adopt(undefined, catalog)
        : resolveLayout(this.#snapshot.layout, catalog).layout
      this.#publish({ layout, blocks: next })
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
    const { blocks, layout } = this.#snapshot
    const resolved = resolveLayout(layout, this.#catalogOf(blocks))
    if (resolved.repaired) this.#publish({ layout: resolved.layout, blocks })
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
    this.#publish({ layout: this.#adopt(saved, this.#catalogOf(blocks)), blocks })
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

  #update(change: (layout: WebuiLayout, catalog: LayoutCatalog) => WebuiLayout, deferrable = false): void {
    this.#following = false
    const { blocks, layout } = this.#snapshot
    const next = change(layout, this.#catalogOf(blocks))
    if (next === layout) return
    this.#publish({ layout: next, blocks })
    if (deferrable && this.#gesture !== null) return
    this.#notify(next)
    if (this.#gesture !== null) this.#gesture = next
  }

  #notify(layout: WebuiLayout): void {
    for (const listener of [...this.#actionListeners]) listener(layout)
  }

  #publish(snapshot: DockSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of [...this.#listeners]) listener()
  }
}
