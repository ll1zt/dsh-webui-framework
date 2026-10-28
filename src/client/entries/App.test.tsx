// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { AppShellProps } from '../../ui/shell/AppShell.tsx'
import type { RegionBoundaryProps } from '../../ui/shell/ErrorBoundary.tsx'
import type { WebuiTranslate } from '../types.ts'
import { App } from './App.tsx'

describe('App', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('A1 catches its own render error in the whole-page panel', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    // The root slot injects more seats (sessions, actions) than this test supplies; hand App only the
    // store and copy seats it uses here.
    const RootEntry = App as unknown as ComponentType<Record<string, unknown>>
    render(
      <RootEntry
        t={(key: string) => key}
        useStore={() => {
          throw new Error('store exploded')
        }}
      />,
    )

    const panel = screen.getByRole('alert')
    expect(panel.textContent).toContain('store exploded')
    fireEvent.click(screen.getByRole('button', { name: 'shell.error.reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('A2 types the webui copy seat by the zh key set', () => {
    expectTypeOf<WebuiTranslate>().toEqualTypeOf<TranslateNS<'webui'>>()
    expectTypeOf<Parameters<typeof App>[0]['t']>().toEqualTypeOf<WebuiTranslate>()
    expectTypeOf<AppShellProps['t']>().toEqualTypeOf<WebuiTranslate | undefined>()
    expectTypeOf<RegionBoundaryProps['t']>().toEqualTypeOf<WebuiTranslate | undefined>()

    const t = ((key: string) => key) as WebuiTranslate
    // @ts-expect-error a key missing from locale/zh.json is a type error
    t('shell.error.nope')
  })
})
