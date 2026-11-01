/** The attribute that marks a pane element; its value is the pane's path joined with dots ('' for the root). */
export const PANE_ATTRIBUTE = 'data-webui-pane'

const PATH_SHAPE = /^(\d+(\.\d+)*)?$/

/** The path of the pane `element` is in or is, or undefined when it is outside every pane. */
export function panePathOfElement(element: Element | null): number[] | undefined {
  const value = element?.closest(`[${PANE_ATTRIBUTE}]`)?.getAttribute(PANE_ATTRIBUTE)
  if (value === null || value === undefined || !PATH_SHAPE.test(value)) return undefined
  return value === '' ? [] : value.split('.').map(Number)
}

/** Focuses the selected tab button of the pane at `pane`; false when there is none to focus. */
export function focusActiveTab(root: ParentNode, pane: readonly number[]): boolean {
  const button = root.querySelector<HTMLElement>(
    `[${PANE_ATTRIBUTE}="${pane.join('.')}"] [role="tab"][aria-selected="true"]`,
  )
  if (button === null) return false
  button.focus()
  return true
}
