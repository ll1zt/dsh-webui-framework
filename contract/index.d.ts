/**
 * Type-only contract of @lllzt/dsh-webui-framework/contract.
 *
 * Contributors `import type` from here and nothing else: this file holds no JavaScript, so a value
 * import fails to compile. Wait for the service with `ctx.inject(['webuiLayout'], cb)` and register
 * blocks and presets inside `cb`.
 *
 * A session block reads the session through `props.session` and no longer reads the host's standard
 * props. From 0.3.0 a session block receives only `SessionBlockProps`.
 *
 * Registering a block straight through `slots.register` bypasses the de-duplication that
 * `registerBlock` performs.
 *
 * `props.layout.undo()` and `redo()` step back and forth over what the user did to the layout: the five layout actions,
 * dragging or resizing a split, and undo / redo themselves. Tab titles and close guards are not part of it. The history
 * lives in the current page only: a reload, or a saved layout being loaded, empties it. It keeps at most 100 steps. The
 * layout a step lands on is repaired against the blocks registered now; a step that would drop a tab whose close guard
 * refuses is rejected with `vetoed`, and `no-history` says there is no step to take. `props.view.canUndo()` and
 * `canRedo()` tell whether a step exists.
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

interface BlockMetaBase {
  id: string
  /** Blocks are ordered by `priority` ascending, ties by `id` in code-point order: lower comes first. */
  priority: number
  title: LocalizedText
  closable: boolean
  multiInstance: boolean
  defaultSize?: LayoutSize
}

/** A block shown once for the whole page; its component takes `BlockInstanceProps`. */
export interface RootBlockMeta extends BlockMetaBase {
  scope: 'root'
}

/** A block shown for the current main session; its component takes `SessionBlockProps`. */
export interface SessionBlockMeta extends BlockMetaBase {
  scope: 'session'
}

/** Static description of a block, given once at registration; `scope` decides the component type. */
export type BlockMeta = RootBlockMeta | SessionBlockMeta

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
 * - `vetoed`: a tab's close guard refused the close, or the reset, undo or redo that would drop that tab.
 * - `no-history`: there is no step to undo or redo.
 */
export type LayoutActionRejection =
  'unknown-block' | 'not-closable' | 'no-such-tab' | 'not-in-split' | 'vetoed' | 'no-history'

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
  /** Closes the tab. Rejected with `unknown-block`, then `not-closable`, then `no-such-tab`, then `vetoed` by the tab's close guard. */
  close(target: BlockTarget): LayoutActionResult
  /** Activates the tab. Rejected with `unknown-block`, then `no-such-tab`. */
  activate(target: BlockTarget): LayoutActionResult
  /** Sizes the split slot holding the tab. Rejected with `unknown-block`, then `no-such-tab`, then `not-in-split`. */
  resize(target: BlockTarget, size: LayoutSize): LayoutActionResult
  /**
   * Re-adopts the first preset. Rejected with `vetoed` (and nothing changes) when a tab that is open but absent from
   * that preset has a close guard that refuses; the guards of tabs the preset keeps are not asked.
   */
  resetToPreset(): LayoutActionResult
  /**
   * Goes back to the layout from before the user's last action, repaired against the blocks registered now. Rejected with
   * `no-history`, then `vetoed` (and nothing changes) when a tab it would drop has a close guard that refuses.
   */
  undo(): LayoutActionResult
  /** Undoes the last undo, under the same rules and rejections as `undo`. */
  redo(): LayoutActionResult
}

/**
 * A read-only view of the layout, for blocks that need to know what is open. It has no write method: change the layout
 * through `BlockInstanceProps.layout`.
 */
export interface LayoutView {
  /**
   * The current layout. The same object while the layout does not change (so it suits `useSyncExternalStore`), and deeply
   * frozen. A new tab title or a change of the registered blocks that leaves the layout as it is returns the same object.
   */
  getSnapshot(): WebuiLayout
  /**
   * Calls `listener` once after each change of the layout object, whatever caused it: a layout action, a repair after
   * blocks (un)register, a loaded layout or the registry settling, and once after each change of `canUndo` or `canRedo`
   * (once when the layout and either of them change together). A change of the block list alone that leaves the layout
   * as it is calls nobody. The returned disposer stops the listening.
   */
  subscribe(listener: () => void): Disposer
  /** Whether the layout has the tab `target` names. A single-instance block ignores `contentId`; `contentId` defaults to `''`; an unregistered block is never open. */
  isOpen(target: BlockTarget): boolean
  /** Whether the tab `target` names is open and is the active tab of its pane. */
  isActive(target: BlockTarget): boolean
  /** Whether `props.layout.undo()` has a step to take. */
  canUndo(): boolean
  /** Whether `props.layout.redo()` has a step to take. */
  canRedo(): boolean
}

/** Props every block instance receives. */
export interface BlockInstanceProps {
  blockId: string
  contentId: string
  active: boolean
  layout: BlockLayoutActions
  /** This tab's own handle; the same object for the same tab across renders. */
  tab: BlockTabHandle
  /** A read-only view of the layout; the same object for every block and every render. */
  view: LayoutView
}

/** What a block instance can do to its own tab. */
export interface BlockTabHandle {
  /**
   * Titles this tab (blockId + contentId); the tab button, its close button and its error card use it
   * instead of the block's title. `null` restores the block's title. Ignored while the tab is not in the layout,
   * and a tab's title is dropped when it leaves the layout. It is not a user action and is not saved.
   */
  setTitle(title: LocalizedText | null): void
  /**
   * Sets this tab's close guard, replacing any earlier one; `null` removes it. The guard is asked synchronously when
   * the tab is about to be closed (a `close` action or the tab's × button) and when `resetToPreset` would drop the tab:
   * `false` vetoes, `true` lets it go. A guard that throws vetoes too, and is logged once with a warning. Nothing else
   * asks it: a tab leaving because its block unregisters, its plugin unloads or the layout is repaired is not
   * vetoable. Ignored while the tab is not in the layout; the guard is dropped when the tab leaves the layout.
   */
  setCloseGuard(guard: CloseGuard | null): void
}

/** Returns `false` to veto closing the tab it guards. */
export type CloseGuard = () => boolean

/** The part of the host's session state a block may read. */
export interface WebuiSessionState {
  sessionId: string
  running: boolean
  blank: boolean
  removed: boolean
  openState: 'cold' | 'loading' | 'open' | 'error'
  lastAgentError: string | null
}

/** The current main session as a block sees it; the same object for the same session across renders. */
export interface WebuiSession {
  readonly sessionId: string
  /**
   * A hook: call it while rendering, in the same order every render. The block re-renders only when the selected
   * value changes, by `Object.is` or by `equal` when given.
   */
  useState<T>(select: (state: WebuiSessionState) => T, equal?: (a: T, b: T) => boolean): T
  /**
   * Appends one message in `'queue'` mode. Resolves to `true` when the host accepted it, and to `false` when the host
   * refused, threw, the session is gone or the block has unmounted. Never rejects.
   */
  send(text: string): Promise<boolean>
  /**
   * Stops the running turn, under the same rules as `send`: `true` when the host accepted it, `false` when the host
   * refused, threw, the session is gone or the block has unmounted. Never rejects.
   */
  stop(): Promise<boolean>
}

/** Props a `session`-scope block receives. */
export interface SessionBlockProps extends BlockInstanceProps {
  session: WebuiSession
}

export type BlockComponent = ComponentType<BlockInstanceProps>

/** The component type a block of `M`'s scope takes. */
export type BlockComponentOf<M extends BlockMeta> = ComponentType<
  M extends SessionBlockMeta ? SessionBlockProps : BlockInstanceProps
>

/** Undoes a registration. */
export type Disposer = () => void

export interface WebuiLayoutService {
  registerBlock<M extends BlockMeta>(meta: M, component: BlockComponentOf<M>): Disposer
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
