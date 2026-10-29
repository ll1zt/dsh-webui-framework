/**
 * Type-only contract of @lllzt/dsh-webui-framework/contract.
 *
 * Contributors `import type` from here and nothing else: this file holds no JavaScript, so a value
 * import fails to compile. Wait for the service with `ctx.inject(['webuiLayout'], cb)` and register
 * blocks and presets inside `cb`.
 *
 * A block component receives `BlockInstanceProps` plus the standard props the host passes to the
 * slot it renders in (a webui.block.* slot). Those host props are not re-typed here; read them off
 * the slot's own props type.
 *
 * Registering a block straight through `slots.register` bypasses the de-duplication that
 * `registerBlock` performs.
 */
import type { ComponentType } from 'react'

/** Slot keys blocks are mounted under, one per block scope. */
export type WebuiSlotKey = 'webui.block.root' | 'webui.block.session'

/** Where a block lives: once for the whole page, or once per session. */
export type BlockScope = 'root' | 'session'

/** A size in pixels, clamped between `min` and `max`. */
export interface LayoutPxSize {
  px: number
  min: number
  max: number
}

/** A share of the remaining space. */
export interface LayoutFrSize {
  fr: number
}

export type LayoutSize = LayoutPxSize | LayoutFrSize

export interface LocalizedText {
  zh: string
  en: string
}

/** Static description of a block, given once at registration. */
export interface BlockMeta {
  id: string
  scope: BlockScope
  /** Blocks are ordered by `priority` ascending, ties by `id` in code-point order: lower comes first. */
  priority: number
  title: LocalizedText
  closable: boolean
  multiInstance: boolean
  defaultSize?: LayoutSize
}

/** One open tab: a block and the content it shows. */
export interface BlockRef {
  blockId: string
  contentId: string
}

export interface LayoutPane {
  kind: 'pane'
  tabs: readonly BlockRef[]
  active: number
}

export interface LayoutSplit {
  kind: 'split'
  axis: 'row' | 'column'
  children: readonly LayoutNode[]
  sizes: readonly LayoutSize[]
}

export type LayoutNode = LayoutPane | LayoutSplit

/** The layout tree; `activePane` is the child-index path from the root to the active pane. */
export interface WebuiLayout {
  version: 1
  root: LayoutNode | null
  activePane: readonly number[]
}

/**
 * A layout a contributor offers as a starting point. Presets are ordered by `priority` ascending,
 * ties by `id` in code-point order, and the framework adopts the first one: the lowest number wins.
 */
export interface LayoutPreset {
  id: string
  priority: number
  layout: WebuiLayout
}

/** Names a block, and optionally one of its contents. */
export interface BlockTarget {
  blockId: string
  contentId?: string
}

/** Layout operations a block instance may ask for. */
export interface BlockLayoutActions {
  open(target: BlockTarget): void
  close(target: BlockTarget): void
  activate(target: BlockTarget): void
  resize(target: BlockTarget, size: LayoutSize): void
  resetToPreset(): void
}

/** Props every block instance receives. */
export interface BlockInstanceProps {
  blockId: string
  contentId: string
  active: boolean
  layout: BlockLayoutActions
}

export type BlockComponent = ComponentType<BlockInstanceProps>

/** Undoes a registration. */
export type Disposer = () => void

export interface WebuiLayoutService {
  registerBlock(meta: BlockMeta, component: BlockComponent): Disposer
  registerPreset(preset: LayoutPreset): Disposer
}

/** Theme custom properties defined on body, the names blocks may read with `var(...)`. */
export type WebuiTokenName =
  | '--bg'
  | '--bg-panel'
  | '--bg-subtle'
  | '--bg-hover'
  | '--bg-selected'
  | '--border'
  | '--text'
  | '--text-muted'
  | '--text-dim'
  | '--accent'
  | '--accent-hover'
  | '--accent-contrast'
  | '--font-ui'
  | '--font-mono'
  | '--content-font-size'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webuiLayout: WebuiLayoutService
  }
}
