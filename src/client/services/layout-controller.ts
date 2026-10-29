/** Holds the layout the dock draws: starts from the registry's first preset and follows registry changes. */
import type {
  BlockLayoutActions,
  BlockMeta,
  BlockTarget,
  LayoutSize,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { chooseLayout, resolveLayout, type LayoutCatalog } from '../../lib/layout.ts'
import { activateBlock, closeBlock, openBlock, resizeBlock } from '../../lib/layout-ops.ts'
import type { BlockRegistration, BlockRegistry } from './block-registry.ts'

/** What the dock renders: the layout tree and the blocks registered right now. */
export interface DockSnapshot {
  layout: WebuiLayout
  blocks: readonly BlockRegistration[]
}

/** The layout of one page, as an observable snapshot the injected `useDock` hook reads. */
export class LayoutController {
  readonly #registry: BlockRegistry
  readonly #listeners = new Set<() => void>()
  #snapshot: DockSnapshot
  #settled = false
  /** True until the layout is first set by an action or a saved layout: until then it follows the presets. */
  #following = true

  readonly actions: BlockLayoutActions = {
    open: (target) => this.#update((layout, catalog) => openBlock(layout, target, catalog)),
    close: (target) => this.#update((layout, catalog) => closeBlock(layout, target, catalog)),
    activate: (target) => this.#update((layout, catalog) => activateBlock(layout, this.#singled(target, catalog))),
    resize: (target, size: LayoutSize) =>
      this.#update((layout, catalog) => resizeBlock(layout, this.#singled(target, catalog), size)),
    resetToPreset: () => this.#update((_layout, catalog) => this.#adopt(undefined, catalog)),
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

  #update(change: (layout: WebuiLayout, catalog: LayoutCatalog) => WebuiLayout): void {
    this.#following = false
    const { blocks, layout } = this.#snapshot
    const next = change(layout, this.#catalogOf(blocks))
    if (next !== layout) this.#publish({ layout: next, blocks })
  }

  #publish(snapshot: DockSnapshot): void {
    this.#snapshot = snapshot
    for (const listener of [...this.#listeners]) listener()
  }
}
