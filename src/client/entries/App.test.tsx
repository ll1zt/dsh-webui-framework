// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BlockInstanceProps, BlockMeta, LayoutNode, WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { emptyLayout } from '../../lib/layout.ts'
import type { BlockErrorCardProps } from '../../ui/shell/ErrorBoundary.tsx'
import type { BlockRegistration } from '../services/block-registry.ts'
import type { BlockFailure } from '../services/entry-errors.ts'
import type { DockSnapshot } from '../services/layout-controller.ts'
import type { WebuiTranslate } from '../types.ts'
import { App } from './App.tsx'

const ROOT_KEY = 'webui.block.root'
const SESSION_KEY = 'webui.block.session'

function registration(id: string, scope: BlockMeta['scope']): BlockRegistration {
  const meta: BlockMeta = {
    id,
    scope,
    priority: 0,
    title: { zh: `${id}-zh`, en: `${id}-en` },
    closable: true,
    multiInstance: false,
  }
  return { meta, component: () => null, owner: 'test' }
}

function pane(...ids: string[]): LayoutNode {
  return { kind: 'pane', tabs: ids.map((blockId) => ({ blockId, contentId: '' })), active: 0 }
}

function snapshotOf(root: LayoutNode | null, blocks: BlockRegistration[]): DockSnapshot {
  const layout: WebuiLayout = root === null ? emptyLayout() : { version: 1, root, activePane: [] }
  return { layout, blocks }
}

interface SessionProviderProps {
  session?: unknown
  empty?: () => ReactNode
  children: ReactNode
}

/**
 * Hand App the props the root slot would compose for it. The root slot injects more seats than the
 * typed surface exposes here, so App is cast to a loose component.
 */
function renderApp(
  snapshot: DockSnapshot,
  {
    hasSession = false,
    language = 'zh-CN',
    failures = new Map<string, BlockFailure>(),
  }: { hasSession?: boolean; language?: string; failures?: ReadonlyMap<string, BlockFailure> } = {},
) {
  const dockActions = { open: vi.fn(), close: vi.fn(), activate: vi.fn(), resize: vi.fn(), resetToPreset: vi.fn() }
  // A session-scope slot without a main session renders the caller's fallback; otherwise a marker.
  const renderSlot = vi.fn((key: string, _owner: BlockInstanceProps, opts: { only: string; fallback?: ReactNode }) =>
    key === SESSION_KEY && !hasSession ? (opts.fallback ?? null) : <div data-testid={`slot-${opts.only}`} />,
  )
  // Mirrors the host: without a main session only `empty` renders, even when the caller passed none.
  const SessionProvider = vi.fn(({ children, empty }: SessionProviderProps) =>
    hasSession ? <>{children}</> : <>{empty?.() ?? null}</>,
  )
  const retryBlock = vi.fn()
  const RootEntry = App as unknown as ComponentType<Record<string, unknown>>
  render(
    <RootEntry
      t={(key: string) => key}
      useDock={<S,>(select: (value: DockSnapshot) => S) => select(snapshot)}
      useLocale={<S,>(select: (value: unknown) => S) => select({ active: language, locales: [], revision: 0 })}
      useErrors={<S,>(select: (value: ReadonlyMap<string, BlockFailure>) => S) => select(failures)}
      retryBlock={retryBlock}
      dockActions={dockActions}
      renderSlot={renderSlot}
      SessionProvider={SessionProvider}
    />,
  )
  return { renderSlot, SessionProvider, dockActions, retryBlock }
}

describe('App', () => {
  afterEach(() => {
    cleanup()
  })

  it('A1 shows the empty dock copy without an error panel when there are no blocks and no layout', () => {
    const { renderSlot } = renderApp(snapshotOf(null, []))

    expect(screen.getByText('dock.empty')).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(renderSlot).not.toHaveBeenCalled()
  })

  it('A2 titles the tabs in the active locale language', () => {
    renderApp(snapshotOf(pane('a'), [registration('a', 'root')]), { language: 'en' })

    expect(screen.getByRole('tab', { name: 'a-en' })).not.toBeNull()
  })

  it('A3 renders each block through renderSlot of its scope slot, only that block, with the instance props and no ctx', () => {
    const snapshot = snapshotOf(pane('r1', 's1'), [registration('r1', 'root'), registration('s1', 'session')])
    const { renderSlot, dockActions } = renderApp(snapshot, { hasSession: true })

    expect(renderSlot).toHaveBeenCalledWith(
      ROOT_KEY,
      { blockId: 'r1', contentId: '', active: true, layout: expect.any(Object) },
      expect.objectContaining({ only: 'r1' }),
    )
    expect(renderSlot).toHaveBeenCalledWith(
      SESSION_KEY,
      { blockId: 's1', contentId: '', active: false, layout: expect.any(Object) },
      expect.objectContaining({ only: 's1' }),
    )
    for (const [, owner] of renderSlot.mock.calls) expect(owner).not.toHaveProperty('ctx')
    expect(screen.getByTestId('slot-r1')).not.toBeNull()
    expect(screen.getByTestId('slot-s1')).not.toBeNull()

    const layout = renderSlot.mock.calls[0]?.[1].layout
    if (layout === undefined) throw new Error('renderSlot was not called')
    expect(Object.keys(layout).sort()).toEqual(['activate', 'close', 'open', 'resetToPreset', 'resize'])
    const target = { blockId: 'r1', contentId: 'x' }
    layout.open(target)
    expect(dockActions.open).toHaveBeenCalledWith(target)
  })

  it('A1 without a main session the root block still renders and a null root still shows dock.empty', () => {
    renderApp(snapshotOf(pane('r1'), [registration('r1', 'root')]), { hasSession: false })

    expect(screen.getByTestId('slot-r1')).not.toBeNull()
    expect(document.querySelector('.webui-dock')).not.toBeNull()
    cleanup()

    renderApp(snapshotOf(null, []), { hasSession: false })

    expect(screen.getByText('dock.empty')).not.toBeNull()
    expect(document.querySelector('.webui-root')?.textContent).toBe('dock.empty')
  })

  it('A3 SessionProvider covers only the session cell, never the whole dock', () => {
    const rootOnly = renderApp(snapshotOf(pane('r1'), [registration('r1', 'root')]), { hasSession: false })

    expect(screen.getByTestId('slot-r1')).not.toBeNull()
    expect(rootOnly.SessionProvider).not.toHaveBeenCalled()
    cleanup()

    const sessionCell = renderApp(snapshotOf(pane('s1'), [registration('s1', 'session')]), { hasSession: true })

    expect(sessionCell.SessionProvider).toHaveBeenCalledTimes(1)
    for (const [props] of sessionCell.SessionProvider.mock.calls) expect(props).not.toHaveProperty('session')
    expect(screen.getByTestId('slot-s1')).not.toBeNull()
  })

  it('A6 a session block without a main session shows the session empty copy while a root block still renders', () => {
    const snapshot = snapshotOf(
      { kind: 'split', axis: 'row', children: [pane('r1'), pane('s1')], sizes: [{ fr: 1 }, { fr: 1 }] },
      [registration('r1', 'root'), registration('s1', 'session')],
    )
    const { SessionProvider } = renderApp(snapshot, { hasSession: false })

    expect(screen.getByText('dock.session.empty')).not.toBeNull()
    expect(screen.queryByTestId('slot-s1')).toBeNull()
    expect(screen.getByTestId('slot-r1')).not.toBeNull()
    expect(SessionProvider).toHaveBeenCalled()
    for (const [props] of SessionProvider.mock.calls) expect(props).not.toHaveProperty('session')
  })

  it('A1 a failed block shows its error card in its cell and retry goes through retryBlock', () => {
    const failures = new Map([['r1', { blockId: 'r1', error: new Error('r1 exploded') }]])
    const snapshot = snapshotOf(
      { kind: 'split', axis: 'row', children: [pane('r1'), pane('r2')], sizes: [{ fr: 1 }, { fr: 1 }] },
      [registration('r1', 'root'), registration('r2', 'root')],
    )
    const { retryBlock } = renderApp(snapshot, { failures })

    expect(screen.getByRole('alert').textContent).toContain('r1 exploded')
    expect(screen.queryByTestId('slot-r1')).toBeNull()
    expect(screen.getByTestId('slot-r2')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'shell.error.retry' }))
    expect(retryBlock).toHaveBeenCalledWith('r1')
  })

  it('A2 types the webui copy seat by the zh key set', () => {
    expectTypeOf<WebuiTranslate>().toEqualTypeOf<TranslateNS<'webui'>>()
    expectTypeOf<Parameters<typeof App>[0]['t']>().toEqualTypeOf<WebuiTranslate>()
    expectTypeOf<BlockErrorCardProps['t']>().toEqualTypeOf<WebuiTranslate>()

    const t = ((key: string) => key) as WebuiTranslate
    // @ts-expect-error a key missing from locale/zh.json is a type error
    t('shell.error.nope')
  })
})
