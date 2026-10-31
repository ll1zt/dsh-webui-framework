// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { BlockInstanceProps, BlockMeta, LayoutNode, WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { emptyLayout } from '../../lib/layout.ts'
import type { RegionBoundaryProps } from '../../ui/shell/ErrorBoundary.tsx'
import type { BlockRegistration } from '../services/block-registry.ts'
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
function renderApp(snapshot: DockSnapshot, { hasSession = false, language = 'zh-CN' } = {}) {
  const dockActions = { open: vi.fn(), close: vi.fn(), activate: vi.fn(), resize: vi.fn(), resetToPreset: vi.fn() }
  // A session-scope slot without a main session renders the caller's fallback; otherwise a marker.
  const renderSlot = vi.fn((key: string, _owner: BlockInstanceProps, opts: { only: string; fallback?: ReactNode }) =>
    key === SESSION_KEY && !hasSession ? (opts.fallback ?? null) : <div data-testid={`slot-${opts.only}`} />,
  )
  const SessionProvider = vi.fn(({ children, empty }: SessionProviderProps) =>
    hasSession || empty === undefined ? <>{children}</> : <>{empty()}</>,
  )
  const RootEntry = App as unknown as ComponentType<Record<string, unknown>>
  render(
    <RootEntry
      t={(key: string) => key}
      useDock={<S,>(select: (value: DockSnapshot) => S) => select(snapshot)}
      useLocale={<S,>(select: (value: unknown) => S) => select({ active: language, locales: [], revision: 0 })}
      dockActions={dockActions}
      renderSlot={renderSlot}
      SessionProvider={SessionProvider}
    />,
  )
  return { renderSlot, SessionProvider, dockActions }
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
      { blockId: 'r1', contentId: '', active: true, layout: dockActions },
      expect.objectContaining({ only: 'r1' }),
    )
    expect(renderSlot).toHaveBeenCalledWith(
      SESSION_KEY,
      { blockId: 's1', contentId: '', active: false, layout: dockActions },
      expect.objectContaining({ only: 's1' }),
    )
    for (const [, owner] of renderSlot.mock.calls) expect(owner).not.toHaveProperty('ctx')
    expect(screen.getByTestId('slot-r1')).not.toBeNull()
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

  it('A2 types the webui copy seat by the zh key set', () => {
    expectTypeOf<WebuiTranslate>().toEqualTypeOf<TranslateNS<'webui'>>()
    expectTypeOf<Parameters<typeof App>[0]['t']>().toEqualTypeOf<WebuiTranslate>()
    expectTypeOf<RegionBoundaryProps['t']>().toEqualTypeOf<WebuiTranslate | undefined>()

    const t = ((key: string) => key) as WebuiTranslate
    // @ts-expect-error a key missing from locale/zh.json is a type error
    t('shell.error.nope')
  })
})
