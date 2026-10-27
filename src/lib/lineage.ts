// Adapted from deepseek-harness (MIT): packages/api/session-controller/src/client/sessions/lineage.ts

/** One session as the list knows it: its identity and its optional parent link. */
export interface LineageInput {
  sessionId: string
  parentSessionId?: string | undefined
}

/** One flattened row: the session and the indent depth the sidebar renders it at. */
export interface LineageRow {
  sessionId: string
  depth: number
}

interface PendingRow {
  readonly item: LineageInput
  readonly depth: number
}

/**
 * Flatten sessions into render order. The input order stays authoritative; lineage
 * only moves a child directly behind its parent, so a child never takes part in
 * the caller's own ordering.
 */
export function flattenSessionLineage(items: readonly LineageInput[]): LineageRow[] {
  const listed = new Set(items.map(item => item.sessionId))
  const childrenByParent = new Map<string, LineageInput[]>()
  const roots: LineageInput[] = []
  for (const item of items) {
    const parent = item.parentSessionId
    // An absent parent (or a self-link) is not a lineage edge: a session that
    // points outside the input keeps its own position instead of vanishing.
    if (parent === undefined || parent === item.sessionId || !listed.has(parent)) {
      roots.push(item)
      continue
    }
    const siblings = childrenByParent.get(parent)
    if (siblings === undefined) childrenByParent.set(parent, [item])
    else siblings.push(item)
  }

  const rows: LineageRow[] = []
  const visited = new Set<string>()
  const stack: PendingRow[] = []
  const emit = (start: LineageInput): void => {
    stack.push({ item: start, depth: 0 })
    while (stack.length > 0) {
      const next = stack.pop()
      if (next === undefined) continue
      const { item, depth } = next
      // A cycle has no root, so the walk stops at the first member it already
      // emitted; the fallback pass below then enters the ring once as a root.
      if (visited.has(item.sessionId)) continue
      visited.add(item.sessionId)
      rows.push({ sessionId: item.sessionId, depth })
      const children = childrenByParent.get(item.sessionId)
      if (children === undefined) continue
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index]
        if (child !== undefined) stack.push({ item: child, depth: depth + 1 })
      }
    }
  }

  for (const root of roots) emit(root)
  for (const item of items) {
    if (!visited.has(item.sessionId)) emit(item)
  }
  return rows
}
