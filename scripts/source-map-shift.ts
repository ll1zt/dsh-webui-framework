/** Compare a reflowed fragment with its configured text: rolldown may only re-indent it. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * Move every generated mapping by `shift` lines, positive meaning later.
 * Mappings for lines that no longer exist are dropped.
 */
export function shiftMappings(mappings: string, shift: number): string {
  if (shift === 0) return mappings
  const lines = mappings.split(';')
  return shift > 0 ? [...Array<string>(shift).fill(''), ...lines].join(';') : lines.slice(-shift).join(';')
}
