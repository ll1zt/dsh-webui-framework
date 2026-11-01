import type { WebuiLayout } from '@lllzt/dsh-webui-framework/contract'

/** Undo steps kept; recording beyond this drops the oldest snapshot. */
export const LAYOUT_HISTORY_LIMIT = 100

/** Layout snapshots: `past` is oldest to newest, the last `future` entry is the next redo target. */
export interface LayoutHistory {
  readonly past: readonly WebuiLayout[]
  readonly future: readonly WebuiLayout[]
}

export const EMPTY_LAYOUT_HISTORY: LayoutHistory = { past: [], future: [] }

/** The layout a step lands on, with the history that remains after it. */
export interface LayoutHistoryStep {
  readonly history: LayoutHistory
  readonly layout: WebuiLayout
}

/** Records the layout from before an action; this discards any redo branch. */
export function recordLayout(history: LayoutHistory, before: WebuiLayout): LayoutHistory {
  return { past: [...history.past, before].slice(-LAYOUT_HISTORY_LIMIT), future: [] }
}

/** Undo: lands on the newest past layout and parks `current` for redo. */
export function stepBack(history: LayoutHistory, current: WebuiLayout): LayoutHistoryStep | undefined {
  const layout = history.past.at(-1)
  if (layout === undefined) return undefined
  return { layout, history: { past: history.past.slice(0, -1), future: [...history.future, current] } }
}

/** Redo: lands on the next future layout and parks `current` for undo. */
export function stepForward(history: LayoutHistory, current: WebuiLayout): LayoutHistoryStep | undefined {
  const layout = history.future.at(-1)
  if (layout === undefined) return undefined
  return { layout, history: { past: [...history.past, current], future: history.future.slice(0, -1) } }
}
