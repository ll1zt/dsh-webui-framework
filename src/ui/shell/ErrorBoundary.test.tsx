// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary, RegionBoundary } from './ErrorBoundary.tsx'

const ERROR_MESSAGE = 'boundary exploded'

const translate = (key: string): string => key

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('A5 shows the whole-page panel and reloads the window', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    function Boom(): ReactNode {
      throw new Error(ERROR_MESSAGE)
    }

    const { container } = render(
      <AppErrorBoundary t={translate}>
        <Boom />
      </AppErrorBoundary>,
    )

    expect(container.textContent).toContain(ERROR_MESSAGE)
    fireEvent.click(screen.getByRole('button', { name: 'shell.error.reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('A6 copies the error message and stack to the clipboard', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })

    function Boom(): ReactNode {
      throw new Error(ERROR_MESSAGE)
    }

    render(
      <RegionBoundary region="main" t={translate}>
        <Boom />
      </RegionBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'shell.error.copy' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    const copied = String(writeText.mock.calls[0]?.[0])
    expect(copied).toContain(ERROR_MESSAGE)
    // React's dev rethrow hands the boundary an error rebuilt by the browser error event, so compare the
    // stack shape (a frame line) instead of the identity of the Error the test threw.
    expect(copied).toMatch(/^\s+at\s/m)
  })
})
