// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'
import type { RegionBoundaryProps } from '../../ui/shell/ErrorBoundary.tsx'
import type { WebuiTranslate } from '../types.ts'
import { App } from './App.tsx'

describe('App', () => {
  afterEach(() => {
    cleanup()
  })

  it('A1 renders an empty root container without an error panel', () => {
    // The root slot injects more seats (sessions, actions) than this test supplies; hand App only the
    // copy seat it uses here.
    const RootEntry = App as unknown as ComponentType<Record<string, unknown>>
    const { container } = render(<RootEntry t={(key: string) => key} />)

    const root = container.querySelector('.webui-root')
    expect(root).not.toBeNull()
    expect(root?.childElementCount).toBe(0)
    expect(screen.queryByRole('alert')).toBeNull()
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
