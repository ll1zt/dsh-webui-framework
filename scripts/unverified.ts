/**
 * Conclusions from the session-adapter spike that were never run on a host,
 * and which check already locks each one.
 *
 * The list is the numbered items under `### 未在宿主上验证的结论`. An id the
 * table does not name stays `manual`, so a newly added conclusion still shows
 * up for a human instead of disappearing.
 */

/** `session-adapter.test.ts` when that file asserts the conclusion; otherwise a human recheck. */
export interface Unverified {
  id: string
  text: string
  check: 'session-adapter.test.ts' | 'manual'
}

/**
 * Fixed id → check. Only a conclusion the adapter tests would fail is pointed
 * at that file. A nearby test that stubs the host does not count: a host
 * upgrade would still leave it green.
 *
 * 2 — `stateSourceOf` returns the same object until one of the six mapped
 *     fields changes (`session-adapter.test.ts` A2). That is the uSES
 *     `getSnapshot` contract this conclusion states. The bridge test also
 *     checks the rerender half; the check name recorded here is the adapter file.
 * 1 — host `binding()` at inject time. A8 only supplies a fake `binding`.
 * 3 — the session entry remounts once when the main session switches. Not asserted.
 * 4 — host queue-while-running, and what idle `cancel()` answers. Tests only
 *     pass `'queue'` through and map a scripted result.
 * 5 — how the host `prompt` promise settles when its generation is dropped.
 *     A6 settles our promise against a fake that never settles.
 * 6 — the host rejects blank text and writes `promptError`. The adapter test
 *     returns before calling the host.
 * 7 — a framework-written `inject` is accepted on the session list slot.
 *     Tests register against a fake slot registry.
 */
export const UNVERIFIED_CHECKS: Readonly<Record<string, Unverified['check']>> = {
  '1': 'manual',
  '2': 'session-adapter.test.ts',
  '3': 'manual',
  '4': 'manual',
  '5': 'manual',
  '6': 'manual',
  '7': 'manual',
}

const SECTION_HEADING = '### 未在宿主上验证的结论'
const NEXT_HEADING = /^#{1,6}\s+\S/
const NUMBERED_ITEM = /^(\d+)\.\s+(.*)$/

/**
 * Numbered items under `### 未在宿主上验证的结论`, and nothing else.
 * A wrapped item's following lines join with a space until the next item or heading.
 * @param markdown - spike (or any markdown) text.
 * @returns one entry per numbered item in that section, in order.
 */
export function readUnverified(markdown: string): Unverified[] {
  const lines = markdown.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === SECTION_HEADING)
  if (start < 0) return []
  const items: Unverified[] = []
  let current: { id: string; parts: string[] } | undefined
  const flush = (): void => {
    if (current === undefined) return
    const text = current.parts
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .join(' ')
    items.push({ id: current.id, text, check: UNVERIFIED_CHECKS[current.id] ?? 'manual' })
    current = undefined
  }
  for (const line of lines.slice(start + 1)) {
    if (NEXT_HEADING.test(line)) break
    const match = NUMBERED_ITEM.exec(line)
    if (match !== null) {
      flush()
      const id = match[1]
      if (id === undefined) continue
      current = { id, parts: [match[2] ?? ''] }
      continue
    }
    if (current !== undefined && line.trim() !== '') current.parts.push(line)
  }
  flush()
  return items
}

/**
 * One bullet per conclusion: the test file that locks it, or `需人工复核`.
 * An empty list is `（无）`.
 * @param items - conclusions, in the order to print.
 * @returns a markdown fragment. Empty input is the single token `（无）`.
 */
export function unverifiedSection(items: readonly Unverified[]): string {
  if (items.length === 0) return '（无）\n'
  const bullets = items.map((item) => {
    const where = item.check === 'manual' ? '需人工复核' : item.check
    return `- ${item.id}. ${item.text}: ${where}`
  })
  return `${bullets.join('\n')}\n`
}
