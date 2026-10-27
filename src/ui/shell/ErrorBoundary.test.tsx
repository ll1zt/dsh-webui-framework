// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary, RegionBoundary } from './ErrorBoundary.tsx'

const ERROR_MESSAGE = 'boundary exploded'

describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('TestBoundary_A5 shows the whole-page panel and reloads the window', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.resolve() } })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    function Boom(): ReactNode {
      throw new Error(ERROR_MESSAGE)
    }

    const { container } = render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(container.textContent).toContain(ERROR_MESSAGE)
    const actions = screen.getAllByRole('button')
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) fireEvent.click(action)
    expect(reload).toHaveBeenCalled()
  })

  it('TestBoundary_A6 copies the error message and stack to the clipboard', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })

    function Boom(): ReactNode {
      throw new Error(ERROR_MESSAGE)
    }

    render(
      <RegionBoundary region="main">
        <Boom />
      </RegionBoundary>,
    )

    for (const action of screen.getAllByRole('button')) {
      fireEvent.click(action)
      if (writeText.mock.calls.length > 0) break
    }

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = String(writeText.mock.calls[0]?.[0])
    expect(copied).toContain(ERROR_MESSAGE)
    // React's dev rethrow hands the boundary an error rebuilt by the browser error event, so compare the
    // stack shape (a frame line) instead of the identity of the Error the test threw.
    expect(copied).toMatch(/^\s+at\s/m)
  })
})
