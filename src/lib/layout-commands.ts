import type { BlockRef, LayoutNode, LayoutPane, WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import { nodeAt } from './layout.ts'

/** The ids of the layout commands the framework registers on the host's shortcuts service. */
export type LayoutCommandId =
  | 'webui.tab.close'
  | 'webui.tab.next'
  | 'webui.tab.previous'
  | 'webui.pane.next'
  | 'webui.pane.previous'
  | 'webui.layout.undo'
  | 'webui.layout.redo'

export const LAYOUT_COMMAND_IDS: readonly LayoutCommandId[] = [
  'webui.tab.close',
  'webui.tab.next',
  'webui.tab.previous',
  'webui.pane.next',
  'webui.pane.previous',
  'webui.layout.undo',
  'webui.layout.redo',
]

/** What a command comes down to; whether an undo or redo is possible is for the caller to judge. */
export type LayoutCommandStep =
  | { readonly kind: 'close'; readonly target: BlockRef }
  | { readonly kind: 'activate'; readonly target: BlockRef; readonly pane: readonly number[] }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }

/** Path of every pane, depth first and front to back (left to right, top to bottom). */
export function panePaths(root: LayoutNode | null): number[][] {
  if (root === null) return []
  if (root.kind === 'pane') return [[]]
  return root.children.flatMap((child, index) => panePaths(child).map((path) => [index, ...path]))
}

function paneAt(root: LayoutNode, path: readonly number[]): LayoutPane | undefined {
  const node = nodeAt(root, path)
  return node?.kind === 'pane' ? node : undefined
}

/** The tab `offset` places from the pane's active one, wrapping around; undefined for a lone tab. */
function neighbourTab(pane: LayoutPane, offset: 1 | -1): BlockRef | undefined {
  if (pane.tabs.length < 2) return undefined
  return pane.tabs[(pane.active + offset + pane.tabs.length) % pane.tabs.length]
}

/** What `command` does with the current pane: the focused one when it is a pane, else the active one. */
export function planLayoutCommand(
  layout: WebuiLayout,
  command: LayoutCommandId,
  focusedPane: readonly number[] | undefined,
): LayoutCommandStep | undefined {
  const { root } = layout
  if (root === null) return undefined
  if (command === 'webui.layout.undo') return { kind: 'undo' }
  if (command === 'webui.layout.redo') return { kind: 'redo' }
  const current = focusedPane !== undefined && paneAt(root, focusedPane) !== undefined ? focusedPane : layout.activePane
  const pane = paneAt(root, current)
  if (pane === undefined) return undefined
  switch (command) {
    case 'webui.tab.close': {
      const target = pane.tabs[pane.active]
      return target === undefined ? undefined : { kind: 'close', target }
    }
    case 'webui.tab.next':
    case 'webui.tab.previous': {
      const target = neighbourTab(pane, command === 'webui.tab.next' ? 1 : -1)
      return target === undefined ? undefined : { kind: 'activate', target, pane: [...current] }
    }
    case 'webui.pane.next':
    case 'webui.pane.previous': {
      const paths = panePaths(root)
      if (paths.length < 2) return undefined
      const here = paths.findIndex((path) => path.length === current.length && path.every((n, i) => n === current[i]))
      const next = paths[(here + (command === 'webui.pane.next' ? 1 : -1) + paths.length) % paths.length]
      const dest = next === undefined ? undefined : paneAt(root, next)
      const target = dest?.tabs[dest.active]
      return next === undefined || target === undefined ? undefined : { kind: 'activate', target, pane: next }
    }
  }
}
