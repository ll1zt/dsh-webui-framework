import type { SessionListState, SessionProjectionSnapshot, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteraction, SessionStatus, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import type { SessionIndicator, SessionRow, SessionRowsInput } from './session-rows.ts'
import { buildSessionRows, sessionTitleOf } from './session-rows.ts'

type SessionRowItem = Extract<SessionRow, { kind: 'session' }>
type GroupRowItem = Extract<SessionRow, { kind: 'group' }>

const sid = (value: string): SessionId => value as SessionId

function summary(id: string, patch: Partial<Omit<SessionSummary, 'id'>> = {}): SessionSummary {
  return {
    id: sid(id),
    displayTitle: id,
    running: false,
    blank: false,
    retainedBy: {},
    updatedAt: 0,
    ...patch,
  }
}

interface ListFixtureOptions {
  readonly phase?: 'pending' | 'ready'
  readonly titles?: Readonly<Record<string, string | null>>
}

// The `title` projection key is declared by @deepseek-ai/dsh-session-title, which the
// session-controller client types do not pull into the program, so the fixture is asserted.
const projectionValues = (title: string | null): SessionProjectionSnapshot['values'] =>
  ({ title }) as SessionProjectionSnapshot['values']

function listOf(rows: readonly SessionSummary[], options: ListFixtureOptions = {}): SessionListState {
  const byId: Record<string, SessionSummary> = {}
  for (const row of rows) byId[row.id] = row
  const projectionsBySession: Record<string, SessionProjectionSnapshot> = {}
  for (const [id, title] of Object.entries(options.titles ?? {})) {
    projectionsBySession[id] = { values: projectionValues(title), state: 'ready', error: null }
  }
  return {
    ids: rows.map(row => row.id),
    byId,
    phase: options.phase ?? 'ready',
    projectionsBySession,
  }
}

function interactionFor(id: string): SessionPendingInteraction {
  return { key: `pending-${id}`, kind: 'permission', sessionId: sid(id) }
}

function statusOf(entries: Readonly<Record<string, Partial<SessionStatus>>>): SessionStatusSnapshot {
  const status = new Map<SessionId, SessionStatus>()
  for (const [id, patch] of Object.entries(entries)) {
    status.set(sid(id), { running: undefined, pendingInteraction: undefined, completionUnread: false, ...patch })
  }
  return status
}

interface WorkspaceFixture {
  readonly id: string
  readonly title: string
  readonly sessionIds?: readonly string[]
}

function snapshotOf(items: readonly WorkspaceFixture[], patch: Partial<WorkspaceSnapshot> = {}): WorkspaceSnapshot {
  return {
    items: items.map((item): WorkspaceView => ({
      workspaceId: item.id as WorkspaceId,
      path: `/work/${item.id}`,
      title: item.title,
      sessionIds: (item.sessionIds ?? []).map(sid),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    })),
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    ...patch,
  }
}

function build(overrides: Partial<SessionRowsInput> & Pick<SessionRowsInput, 'list'>): SessionRow[] {
  return buildSessionRows({
    status: new Map<SessionId, SessionStatus>(),
    workspaces: undefined,
    selectedId: undefined,
    currentBlankId: undefined,
    expanded: new Set<string>(),
    showArchived: false,
    ...overrides,
  })
}

const sessionRows = (rows: readonly SessionRow[]): SessionRowItem[] =>
  rows.filter((row): row is SessionRowItem => row.kind === 'session')
const groupRows = (rows: readonly SessionRow[]): GroupRowItem[] =>
  rows.filter((row): row is GroupRowItem => row.kind === 'group')
const visibleIds = (rows: readonly SessionRow[]): SessionId[] => sessionRows(rows).map(row => row.id)
const groupOf = (rows: readonly SessionRow[], id: string): SessionRowItem | undefined =>
  sessionRows(rows).find(row => row.id === sid(id))
const groupByKey = (rows: readonly SessionRow[], key: string): GroupRowItem | undefined =>
  groupRows(rows).find(row => row.key === key)
const indicatorOf = (rows: readonly SessionRow[], id: string): SessionIndicator | undefined => groupOf(rows, id)?.indicator

describe('buildSessionRows', () => {
  it('TestRows_A1 pending without rows is loading, ready without rows is empty', () => {
    expect(build({ list: listOf([], { phase: 'pending' }) })).toEqual([{ kind: 'loading' }])
    expect(build({ list: listOf([], { phase: 'ready' }) })).toEqual([{ kind: 'empty' }])

    const onlyFiltered = listOf([summary('blank-one', { blank: true })])
    expect(build({ list: onlyFiltered })).toEqual([{ kind: 'empty' }])
  })

  it('TestRows_A2 hides blank sessions except the current blank, and archived unless shown', () => {
    const list = listOf([
      summary('blank-one', { blank: true, updatedAt: 30 }),
      summary('current-blank', { blank: true, updatedAt: 20 }),
      summary('archived-one', { updatedAt: 40 }),
      summary('live-one', { updatedAt: 10 }),
    ])
    const workspaces = snapshotOf(
      [{ id: 'ws-1', title: 'Alpha', sessionIds: ['blank-one', 'current-blank', 'archived-one', 'live-one'] }],
      { archivedSessionIds: [sid('archived-one')] },
    )
    const expanded = new Set(['ws:ws-1'])
    const currentBlankId = sid('current-blank')

    const hidden = build({ list, workspaces, expanded, currentBlankId })
    expect(visibleIds(hidden)).toEqual([sid('current-blank'), sid('live-one')])
    expect(groupOf(hidden, 'current-blank')?.archived).toBe(false)

    expect(visibleIds(build({ list, workspaces, expanded }))).toEqual([sid('live-one')])

    const shown = build({ list, workspaces, expanded, currentBlankId, showArchived: true })
    expect(visibleIds(shown)).toEqual([sid('archived-one'), sid('current-blank'), sid('live-one')])
    expect(groupOf(shown, 'archived-one')?.archived).toBe(true)
    expect(groupOf(shown, 'live-one')?.archived).toBe(false)
  })

  it('TestRows_A3 groups pinned, then workspaces in item order, then cwd buckets', () => {
    const list = listOf([
      summary('pinned-new', { updatedAt: 5 }),
      summary('pinned-old', { updatedAt: 1 }),
      summary('w1-old', { updatedAt: 100 }),
      summary('w1-new', { updatedAt: 200 }),
      summary('w2-only', { updatedAt: 50 }),
      summary('other-cwd', { updatedAt: 70, cwd: '/a/b' }),
      summary('loose', { updatedAt: 60 }),
    ])
    const workspaces = snapshotOf(
      [
        { id: 'ws-1', title: 'Alpha', sessionIds: ['w1-old', 'w1-new', 'pinned-new', 'pinned-old'] },
        { id: 'ws-2', title: 'Beta', sessionIds: ['w2-only'] },
      ],
      { pinnedSessionIds: [sid('pinned-new'), sid('pinned-old')] },
    )
    const rows = build({
      list,
      workspaces,
      expanded: new Set(['pinned', 'ws:ws-1', 'ws:ws-2', 'cwd:/a/b', 'cwd:']),
    })

    const groups = groupRows(rows)
    expect(groups.slice(0, 3).map(group => group.key)).toEqual(['pinned', 'ws:ws-1', 'ws:ws-2'])
    expect(groups.slice(3).map(group => group.key).sort()).toEqual(['cwd:', 'cwd:/a/b'])
    expect(groupByKey(rows, 'pinned')?.label).toEqual({ kind: 'pinned' })
    expect(groupByKey(rows, 'ws:ws-1')?.label).toEqual({ kind: 'text', text: 'Alpha' })
    expect(groupByKey(rows, 'ws:ws-2')?.label).toEqual({ kind: 'text', text: 'Beta' })
    expect(groupByKey(rows, 'cwd:/a/b')?.label).toEqual({ kind: 'text', text: 'b' })
    expect(groupByKey(rows, 'cwd:')?.label).toEqual({ kind: 'other' })

    const ofGroup = (key: string): SessionId[] =>
      sessionRows(rows)
        .filter(row => row.groupKey === key)
        .map(row => row.id)
    expect(ofGroup('pinned')).toEqual([sid('pinned-new'), sid('pinned-old')])
    expect(ofGroup('ws:ws-1')).toEqual([sid('w1-new'), sid('w1-old')])
    expect(ofGroup('ws:ws-2')).toEqual([sid('w2-only')])
    expect(ofGroup('cwd:/a/b')).toEqual([sid('other-cwd')])
    expect(ofGroup('cwd:')).toEqual([sid('loose')])

    const allIds = visibleIds(rows)
    expect(allIds).toHaveLength(7)
    expect(allIds.filter(id => id === sid('pinned-new'))).toHaveLength(1)
    expect(new Set(allIds).size).toBe(7)
  })

  it('TestRows_A4 indicator prefers pendingInteraction, then running, then unread, then time', () => {
    const list = listOf([
      summary('awaiting-one', { updatedAt: 4 }),
      summary('running-one', { updatedAt: 3 }),
      summary('unread-one', { updatedAt: 2 }),
      summary('idle-one', { updatedAt: 1 }),
      summary('unreported-one', { updatedAt: 0 }),
    ])
    const workspaces = snapshotOf([
      { id: 'ws-1', title: 'Alpha', sessionIds: ['awaiting-one', 'running-one', 'unread-one', 'idle-one', 'unreported-one'] },
    ])
    const status = statusOf({
      'awaiting-one': { running: true, pendingInteraction: interactionFor('awaiting-one'), completionUnread: true },
      'running-one': { running: true, completionUnread: true },
      'unread-one': { running: false, completionUnread: true },
      'idle-one': { running: false, completionUnread: false },
    })
    const rows = build({ list, workspaces, status, expanded: new Set(['ws:ws-1']) })

    expect(indicatorOf(rows, 'awaiting-one')).toBe('awaiting')
    expect(indicatorOf(rows, 'running-one')).toBe('running')
    expect(indicatorOf(rows, 'unread-one')).toBe('unread')
    expect(indicatorOf(rows, 'idle-one')).toBe('time')
    expect(indicatorOf(rows, 'unreported-one')).toBe('time')
  })

  it('TestRows_A5 nests children after their parent and roots a child whose parent is hidden', () => {
    const list = listOf([
      summary('parent', { updatedAt: 10 }),
      summary('child', { parentId: sid('parent'), origin: 'subagent', updatedAt: 500 }),
      summary('hidden-parent', { blank: true, updatedAt: 20 }),
      summary('orphaned-child', { parentId: sid('hidden-parent'), origin: 'subagent', updatedAt: 300 }),
    ])
    const workspaces = snapshotOf([
      { id: 'ws-1', title: 'Alpha', sessionIds: ['parent', 'child', 'hidden-parent', 'orphaned-child'] },
    ])
    const rows = build({ list, workspaces, expanded: new Set(['ws:ws-1']) })

    expect(visibleIds(rows)).toEqual([sid('orphaned-child'), sid('parent'), sid('child')])
    expect(groupOf(rows, 'parent')?.depth).toBe(0)
    expect(groupOf(rows, 'child')?.depth).toBe(1)
    expect(groupOf(rows, 'orphaned-child')?.depth).toBe(0)
  })

  it('TestRows_A6 titles fall back from projection title to cwd basename to session id', () => {
    const list = listOf(
      [
        summary('projected', { updatedAt: 40, cwd: '/a/b' }),
        summary('cwd-only', { updatedAt: 30, cwd: '/a/b/proj' }),
        summary('empty-title', { updatedAt: 20, cwd: '/x/y' }),
        summary('bare', { updatedAt: 10 }),
      ],
      { titles: { projected: 'Projection title', 'cwd-only': null, 'empty-title': '' } },
    )
    const workspaces = snapshotOf([
      { id: 'ws-1', title: 'Alpha', sessionIds: ['projected', 'cwd-only', 'empty-title', 'bare'] },
    ])
    const rows = build({ list, workspaces, expanded: new Set(['ws:ws-1']) })

    expect(groupOf(rows, 'projected')?.title).toBe('Projection title')
    expect(groupOf(rows, 'cwd-only')?.title).toBe('proj')
    expect(groupOf(rows, 'empty-title')?.title).toBe('y')
    expect(groupOf(rows, 'bare')?.title).toBe('bare')
  })

  it('TestRows_A7 collapsed groups emit only their header, selected and pinned groups stay open', () => {
    const list = listOf([
      summary('sel-a', { updatedAt: 90 }),
      summary('sel-b', { updatedAt: 80 }),
      summary('closed-c', { updatedAt: 70 }),
      summary('closed-d', { updatedAt: 60 }),
      summary('third-e', { updatedAt: 50 }),
      summary('third-blank', { blank: true, updatedAt: 40 }),
      summary('pinned-one', { updatedAt: 30 }),
    ])
    const workspaces = snapshotOf(
      [
        { id: 'ws-sel', title: 'Selected', sessionIds: ['sel-a', 'sel-b'] },
        { id: 'ws-closed', title: 'Closed', sessionIds: ['closed-c', 'closed-d'] },
        { id: 'ws-third', title: 'Third', sessionIds: ['third-e', 'third-blank'] },
        { id: 'ws-pinned', title: 'Pinned home', sessionIds: ['pinned-one'] },
      ],
      { pinnedSessionIds: [sid('pinned-one')] },
    )
    const rows = build({ list, workspaces, selectedId: sid('sel-b') })

    const selected = groupByKey(rows, 'ws:ws-sel')
    expect(selected?.expanded).toBe(true)
    expect(selected?.count).toBe(2)
    expect(visibleIds(rows).filter(id => id === sid('sel-a') || id === sid('sel-b'))).toHaveLength(2)

    const closed = groupByKey(rows, 'ws:ws-closed')
    expect(closed?.expanded).toBe(false)
    expect(closed?.count).toBe(2)
    expect(sessionRows(rows).filter(row => row.groupKey === 'ws:ws-closed')).toEqual([])

    const third = groupByKey(rows, 'ws:ws-third')
    expect(third?.count).toBe(1)
    expect(sessionRows(rows).filter(row => row.groupKey === 'ws:ws-third')).toEqual([])

    const pinned = groupByKey(rows, 'pinned')
    expect(pinned?.expanded).toBe(true)
    expect(pinned?.label).toEqual({ kind: 'pinned' })
    expect(pinned?.count).toBe(1)
    expect(groupOf(rows, 'pinned-one')?.groupKey).toBe('pinned')
  })

  it('A1 a plain fork is a root row, only a subagent child nests behind its parent', () => {
    const list = listOf([
      summary('parent', { updatedAt: 100 }),
      summary('fork', { parentId: sid('parent'), updatedAt: 200 }),
    ])
    const workspaces = snapshotOf([{ id: 'ws-1', title: 'Alpha', sessionIds: ['parent', 'fork'] }])
    const forked = build({ list, workspaces, expanded: new Set(['ws:ws-1']) })

    expect(visibleIds(forked)).toEqual([sid('fork'), sid('parent')])
    expect(groupOf(forked, 'fork')?.depth).toBe(0)
    expect(groupOf(forked, 'parent')?.depth).toBe(0)

    const nested = build({
      list: listOf([
        summary('parent', { updatedAt: 100 }),
        summary('agent', { parentId: sid('parent'), origin: 'subagent', updatedAt: 200 }),
      ]),
      workspaces: snapshotOf([{ id: 'ws-1', title: 'Alpha', sessionIds: ['parent', 'agent'] }]),
      expanded: new Set(['ws:ws-1']),
    })
    expect(visibleIds(nested)).toEqual([sid('parent'), sid('agent')])
    expect(groupOf(nested, 'agent')?.depth).toBe(1)
  })

  it('A2 group labels are shapes: pinned, workspace text, cwd basename text, other', () => {
    const list = listOf([
      summary('pinned-one', { updatedAt: 4 }),
      summary('in-ws', { updatedAt: 3 }),
      summary('in-cwd', { updatedAt: 2, cwd: '/a/b' }),
      summary('no-cwd', { updatedAt: 1 }),
    ])
    const workspaces = snapshotOf([{ id: 'ws-1', title: 'Alpha', sessionIds: ['in-ws'] }], {
      pinnedSessionIds: [sid('pinned-one')],
    })
    const rows = build({ list, workspaces })

    expect(groupRows(rows).map(group => [group.key, group.label])).toEqual([
      ['pinned', { kind: 'pinned' }],
      ['ws:ws-1', { kind: 'text', text: 'Alpha' }],
      ['cwd:/a/b', { kind: 'text', text: 'b' }],
      ['cwd:', { kind: 'other' }],
    ])
    expect(groupRows(rows).every(group => !('pinned' in group))).toBe(true)
  })
})

describe('sessionTitleOf', () => {
  it('A4 falls back from projection title to cwd basename to session id, and to the id when unknown', () => {
    const list = listOf(
      [
        summary('titled', { cwd: '/a/b' }),
        summary('in-cwd', { cwd: '/a/b' }),
        summary('bare'),
      ],
      { titles: { titled: 'Fix bug' } },
    )

    expect(sessionTitleOf(list, sid('titled'))).toBe('Fix bug')
    expect(sessionTitleOf(list, sid('in-cwd'))).toBe('b')
    expect(sessionTitleOf(list, sid('bare'))).toBe('bare')
    expect(sessionTitleOf(list, sid('missing'))).toBe('missing')
  })
})
