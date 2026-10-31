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

/**
 * A text in several languages: `en` is required, every other key is a language tag (e.g. `zh`, `zh-TW`, `fr`).
 * For a language the text is the key equal to it as written, else the key of its primary subtag
 * (before the first '-', lower-cased), else `en`.
 */
export interface LocalizedText {
  readonly en: string
  readonly [language: string]: string
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

/**
 * Why a layout action did nothing:
 * - `unknown-block`: no block is registered under the target's blockId.
 * - `not-closable`: the block is registered with `closable: false`.
 * - `no-such-tab`: the block is registered but the layout has no tab for the target.
 * - `not-in-split`: the tab sits in the layout's root pane, so no split gives it a size to change.
 */
export type LayoutActionRejection = 'unknown-block' | 'not-closable' | 'no-such-tab' | 'not-in-split'

/**
 * What a layout action reports, synchronously. `ok: true` means the request was accepted, even when the layout
 * already looked that way (opening an open tab, activating the active one); a rejection changes nothing
 * and is not announced to `onAction` listeners.
 */
export type LayoutActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: LayoutActionRejection }

/** Layout operations a block instance may ask for. */
export interface BlockLayoutActions {
  /** Opens the block's tab, or activates it when open. Rejected with `unknown-block`. */
  open(target: BlockTarget): LayoutActionResult
  /** Closes the tab. Rejected with `unknown-block`, then `not-closable`, then `no-such-tab`. */
  close(target: BlockTarget): LayoutActionResult
  /** Activates the tab. Rejected with `unknown-block`, then `no-such-tab`. */
  activate(target: BlockTarget): LayoutActionResult
  /** Sizes the split slot holding the tab. Rejected with `unknown-block`, then `no-such-tab`, then `not-in-split`. */
  resize(target: BlockTarget, size: LayoutSize): LayoutActionResult
  /** Re-adopts the first preset. Always `ok`. */
  resetToPreset(): LayoutActionResult
}

/** Props every block instance receives. */
export interface BlockInstanceProps {
  blockId: string
  contentId: string
  active: boolean
  layout: BlockLayoutActions
  /** This tab's own handle; the same object for the same tab across renders. */
  tab: BlockTabHandle
}

/** What a block instance can do to its own tab. */
export interface BlockTabHandle {
  /**
   * Titles this tab (blockId + contentId); the tab button, its close button and its error card use it
   * instead of the block's title. `null` restores the block's title. Ignored while the tab is not in the layout,
   * and a tab's title is dropped when it leaves the layout. It is not a user action and is not saved.
   */
  setTitle(title: LocalizedText | null): void
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
