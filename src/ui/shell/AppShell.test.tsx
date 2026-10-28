// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../client/entries/App.tsx'
import type { PageState } from '../../client/services/page-store.ts'
import { AppShell } from './AppShell.tsx'

const PAGE_STATE: PageState = {
  sidebarWidth: 260,
  filesHeight: 240,
  rightPanelOpen: false,
  settingsOpen: false,
  settingsSection: 'general',
}

const translate = (key: string): string => key

describe('AppShell', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('TestShell_A3 renders App with sidebar, topbar and main regions', () => {
    // App's root-slot props are not part of this unit's contract, so the test hands it the composed
    // share its `store`/`locale` registration provides (a selector hook and a translate function).
    const RootEntry = App as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(
      <RootEntry t={translate} useStore={(select: (state: PageState) => unknown) => select(PAGE_STATE)} />,
    )

    for (const region of ['sidebar', 'topbar', 'main']) {
      expect(container.querySelector(`[data-region="${region}"]`)).not.toBeNull()
    }
  })

  it('TestShell_A4 keeps the other regions alive and remounts the failed one on retry', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } })

    let broken = true
    function Flaky(): ReactNode {
      if (broken) throw new Error('sidebar exploded')
      return <span data-testid="sidebar-recovered">recovered</span>
    }

    const { container } = render(
      <AppShell
        t={translate}
        sidebar={<Flaky />}
        topbar={<span data-testid="topbar-content">topbar</span>}
        main={<span data-testid="main-content">main</span>}
      />,
    )

    const sidebar = container.querySelector('[data-region="sidebar"]')
    const main = container.querySelector('[data-region="main"]')
    expect(sidebar?.textContent).toContain('sidebar exploded')
    expect(screen.getByTestId('topbar-content')).toBeTruthy()
    expect(main?.textContent).toContain('main')
    expect(main?.textContent).not.toContain('sidebar exploded')

    const actions = screen.getAllByRole('button')
    expect(actions.length).toBeGreaterThan(0)
    broken = false
    for (const action of actions) {
      fireEvent.click(action)
      if (screen.queryByTestId('sidebar-recovered') !== null) break
    }
    expect(screen.getByTestId('sidebar-recovered')).toBeTruthy()

    const logged = consoleError.mock.calls.map((args) => args.map(String).join(' ')).join('\n')
    expect(logged).toContain('[dsh-web-ui]')
    expect(logged).toContain('sidebar')
  })
})
