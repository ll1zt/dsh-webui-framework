// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockFailure } from '../../client/services/entry-errors.ts'
import { LOG_PREFIX } from '../../client/services/log-prefix.ts'
import { AppErrorBoundary, BlockErrorCard, OverlayBoundary } from './ErrorBoundary.tsx'

const ERROR_MESSAGE = 'boundary exploded'

const translate = (key: string): string => key

const failure = (error = new Error(ERROR_MESSAGE)): BlockFailure => ({ blockId: 'X', error })

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

  it('A3 the overlay boundary renders its children and renders nothing for a throwing child, logging once with the prefix', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = render(
      <OverlayBoundary>
        <span>fine</span>
      </OverlayBoundary>,
    )
    expect(ok.container.textContent).toBe('fine')
    ok.unmount()
    expect(logged).not.toHaveBeenCalled()

    function Boom(): ReactNode {
      throw new Error(ERROR_MESSAGE)
    }

    const { container } = render(
      <OverlayBoundary>
        <Boom />
      </OverlayBoundary>,
    )

    expect(container.innerHTML).toBe('')
    // React may log the caught error itself in development; only the framework's own line carries the prefix
    const own = logged.mock.calls.filter(([first]) => typeof first === 'string' && first.includes(LOG_PREFIX))
    expect(own).toHaveLength(1)
  })

  it('A1 the block card is an alert with the title copy, the block title and the error message', () => {
    render(<BlockErrorCard failure={failure()} title="Block X" t={translate} />)

    const card = screen.getByRole('alert')
    expect(card.textContent).toContain('shell.error.blockTitle')
    expect(card.textContent).toContain('Block X')
    expect(card.textContent).toContain(ERROR_MESSAGE)
  })

  it('A2 copy writes the message and the stack to the clipboard', () => {
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<BlockErrorCard failure={failure()} title="Block X" t={translate} />)

    fireEvent.click(screen.getByRole('button', { name: 'shell.error.copy' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = String(writeText.mock.calls[0]?.[0])
    expect(copied).toContain(ERROR_MESSAGE)
    expect(copied).toMatch(/^\s+at\s/m)
  })

  it('A2 copy writes only the message when the error has no stack', () => {
    const writeText = vi.fn((_text: string) => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const error = new Error(ERROR_MESSAGE)
    delete error.stack
    render(<BlockErrorCard failure={failure(error)} title="Block X" t={translate} />)

    fireEvent.click(screen.getByRole('button', { name: 'shell.error.copy' }))

    expect(writeText).toHaveBeenCalledWith(ERROR_MESSAGE)
  })

  it('A2 copy does not throw without navigator.clipboard', () => {
    render(<BlockErrorCard failure={failure()} title="Block X" t={translate} />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'shell.error.copy' }))).not.toThrow()
  })

  it('A2 copy handles a rejected writeText instead of leaving it unhandled', () => {
    const rejection = Promise.reject(new Error('denied'))
    const handlerAttached = vi.spyOn(rejection, 'then')
    let writes = 0
    // a plain function: vi.fn would itself attach a handler to a returned promise
    const writeText = (_text: string): Promise<void> => {
      writes += 1
      return rejection
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<BlockErrorCard failure={failure()} title="Block X" t={translate} />)

    expect(() => fireEvent.click(screen.getByRole('button', { name: 'shell.error.copy' }))).not.toThrow()

    expect(writes).toBe(1)
    expect(handlerAttached).toHaveBeenCalled()
    rejection.catch(() => {})
  })

  it('A3 the retry button calls onRetry', () => {
    const onRetry = vi.fn()
    render(<BlockErrorCard failure={failure()} title="Block X" onRetry={onRetry} t={translate} />)

    fireEvent.click(screen.getByRole('button', { name: 'shell.error.retry' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('A3 without onRetry there is no retry button', () => {
    render(<BlockErrorCard failure={failure()} title="Block X" t={translate} />)

    expect(screen.queryByRole('button', { name: 'shell.error.retry' })).toBeNull()
    expect(screen.getByRole('button', { name: 'shell.error.copy' })).not.toBeNull()
  })
})
