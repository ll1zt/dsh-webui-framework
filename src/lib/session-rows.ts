import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: registers the `title` key on SessionProjectionMap. The
// session-controller client types do not pull that augmentation into the program.
import type {} from '@deepseek-ai/dsh-session-title/types'
import type { LineageInput } from './lineage.ts'
import { flattenSessionLineage } from './lineage.ts'

/** Status badge a session row shows; `time` is the plain relative-time row. */
export type SessionIndicator = 'awaiting' | 'running' | 'unread' | 'time'

/** What a group header is called; the view owns the wording of `pinned` and `other`. */
export type SessionGroupLabel = { kind: 'pinned' } | { kind: 'other' } | { kind: 'text'; text: string }

/** A group header row. */
export interface SessionGroupRow {
  kind: 'group'
  key: string
  label: SessionGroupLabel
  count: number
  expanded: boolean
}

/** One session row; `depth` is 1 only for a sub-agent nested under its parent. */
export interface SessionItemRow {
  kind: 'session'
  id: SessionId
  groupKey: string
  title: string
  depth: number
  updatedAt: number
  indicator: SessionIndicator
  selected: boolean
  archived: boolean
  running: boolean
}

/** Whole-list placeholder while the list is still loading. */
export interface SessionLoadingRow {
  kind: 'loading'
}

/** Whole-list placeholder when there is nothing to show. */
export interface SessionEmptyRow {
  kind: 'empty'
}

/** One sidebar row: a group header, a session, or the whole-list placeholder. */
export type SessionRow = SessionGroupRow | SessionItemRow | SessionLoadingRow | SessionEmptyRow

/** Everything the row model derives from; no clock, no ambient stores. */
export interface SessionRowsInput {
  readonly list: SessionListState
  readonly status: SessionStatusSnapshot
  readonly workspaces: WorkspaceSnapshot | undefined
  readonly selectedId: SessionId | undefined
  readonly currentBlankId: SessionId | undefined
  readonly expanded: ReadonlySet<string>
  readonly showArchived: boolean
}

const PINNED_GROUP_KEY = 'pinned'
const CWD_GROUP_PREFIX = 'cwd:'

interface GroupDraft {
  readonly key: string
  readonly label: SessionGroupLabel
  readonly sessions: SessionSummary[]
}

const cwdSegments = (cwd: string | undefined): string[] =>
  cwd === undefined ? [] : cwd.split('/').filter(segment => segment.length > 0)

/**
 * The one session-title rule (sidebar, session block header, search): the
 * projected title, else the last cwd segment, else the id itself.
 * @param list - session list the summary and projections come from.
 * @param id - session to title; an id missing from the list titles itself.
 * @returns a non-empty display title.
 */
export function sessionTitleOf(list: SessionListState, id: SessionId): string {
  const projected = list.projectionsBySession[id]?.values.title
  if (typeof projected === 'string' && projected.length > 0) return projected
  return cwdSegments(list.byId[id]?.cwd).at(-1) ?? id
}

const cwdLabelOf = (cwd: string | undefined): SessionGroupLabel => {
  const last = cwdSegments(cwd).at(-1)
  return last === undefined ? { kind: 'other' } : { kind: 'text', text: last }
}

const indicatorOf = (status: SessionStatusSnapshot, id: SessionId): SessionIndicator => {
  const entry = status.get(id)
  if (entry === undefined) return 'time'
  if (entry.pendingInteraction !== undefined) return 'awaiting'
  if (entry.running === true) return 'running'
  return entry.completionUnread ? 'unread' : 'time'
}

/**
 * Derive the sidebar's row sequence: pinned group, then workspace groups in
 * snapshot order, then cwd buckets for sessions no workspace claims. A group
 * emits its sessions only while expanded.
 * @param input - session list, status, workspace snapshot, and view state.
 * @returns rows in render order, or the loading/empty placeholder.
 */
export function buildSessionRows(input: SessionRowsInput): SessionRow[] {
  const { list, status, workspaces, selectedId, currentBlankId, expanded, showArchived } = input
  const archivedIds = new Set<SessionId>(workspaces?.archivedSessionIds ?? [])
  const pinnedIds = new Set<SessionId>(workspaces?.pinnedSessionIds ?? [])

  const workspaceGroups: GroupDraft[] = []
  const workspaceGroupByKey = new Map<string, GroupDraft>()
  // A session listed by two workspaces belongs to the first one, so no group
  // repeats a row another group already owns.
  const workspaceKeyOf = new Map<SessionId, string>()
  for (const view of workspaces?.items ?? []) {
    const key = `ws:${view.workspaceId}`
    if (workspaceGroupByKey.has(key)) continue
    const group: GroupDraft = { key, label: { kind: 'text', text: view.title }, sessions: [] }
    workspaceGroups.push(group)
    workspaceGroupByKey.set(key, group)
    for (const id of view.sessionIds) {
      if (!workspaceKeyOf.has(id)) workspaceKeyOf.set(id, key)
    }
  }

  const pinnedGroup: GroupDraft = { key: PINNED_GROUP_KEY, label: { kind: 'pinned' }, sessions: [] }
  const cwdGroups = new Map<string, GroupDraft>()
  for (const id of list.ids) {
    const summary = list.byId[id]
    if (summary === undefined) continue
    if (summary.blank && id !== currentBlankId) continue
    if (archivedIds.has(id) && !showArchived) continue
    if (pinnedIds.has(id)) {
      pinnedGroup.sessions.push(summary)
      continue
    }
    const workspaceKey = workspaceKeyOf.get(id)
    if (workspaceKey !== undefined) {
      workspaceGroupByKey.get(workspaceKey)?.sessions.push(summary)
      continue
    }
    const cwdKey = `${CWD_GROUP_PREFIX}${summary.cwd ?? ''}`
    const cwdGroup = cwdGroups.get(cwdKey)
    if (cwdGroup === undefined) {
      cwdGroups.set(cwdKey, {
        key: cwdKey,
        label: cwdLabelOf(summary.cwd),
        sessions: [summary],
      })
    } else {
      cwdGroup.sessions.push(summary)
    }
  }

  const drafts = [pinnedGroup, ...workspaceGroups, ...cwdGroups.values()].filter(
    group => group.sessions.length > 0,
  )
  const rows: SessionRow[] = []
  for (const group of drafts) {
    const isExpanded = group.key === PINNED_GROUP_KEY
      || expanded.has(group.key)
      || group.sessions.some(summary => summary.id === selectedId)
    rows.push({
      kind: 'group',
      key: group.key,
      label: group.label,
      count: group.sessions.length,
      expanded: isExpanded,
    })
    if (isExpanded) rows.push(...sessionRowsOf(group, list, status, archivedIds, selectedId))
  }
  if (rows.length === 0) return [list.phase === 'pending' ? { kind: 'loading' } : { kind: 'empty' }]
  return rows
}

/**
 * Order one group's visible sessions: roots by recency, children pulled behind
 * their parent by lineage so a nested row never takes part in the re-sort.
 */
function sessionRowsOf(
  group: GroupDraft,
  list: SessionListState,
  status: SessionStatusSnapshot,
  archivedIds: ReadonlySet<SessionId>,
  selectedId: SessionId | undefined,
): SessionRow[] {
  const byRecency = [...group.sessions].sort((left, right) => right.updatedAt - left.updatedAt)
  const lineage: LineageInput[] = byRecency.map(summary => ({
    sessionId: summary.id,
    // Only a sub-agent nests under its source; a plain fork is a root of its own.
    parentSessionId: summary.origin === 'subagent' ? summary.parentId : undefined,
  }))
  const summaries = new Map<string, SessionSummary>()
  for (const summary of byRecency) summaries.set(summary.id, summary)

  const rows: SessionRow[] = []
  for (const entry of flattenSessionLineage(lineage)) {
    const summary = summaries.get(entry.sessionId)
    if (summary === undefined) continue
    rows.push({
      kind: 'session',
      id: summary.id,
      groupKey: group.key,
      title: sessionTitleOf(list, summary.id),
      depth: entry.depth,
      updatedAt: summary.updatedAt,
      indicator: indicatorOf(status, summary.id),
      selected: summary.id === selectedId,
      archived: archivedIds.has(summary.id),
      running: summary.running,
    })
  }
  return rows
}
