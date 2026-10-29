/**
 * The shell's two failure faces: a per-region card that leaves the rest of the
 * page alive, and a whole-page panel for a crash above every region. These are
 * the package's only class components — catching a render error is the one
 * thing hooks cannot do.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { WebuiTranslate } from '../../client/types.ts'

export type RegionName = 'sidebar' | 'topbar' | 'main' | 'right'

const LOG_PREFIX = '[webui-framework]'

export interface RegionBoundaryProps {
  region: RegionName
  children: ReactNode
  t?: WebuiTranslate | undefined
}

interface AppErrorBoundaryProps {
  children: ReactNode
  t?: WebuiTranslate | undefined
}

interface BoundaryState {
  error: Error | undefined
}

/**
 * Resolve copy through the injected seat, falling back to English when the owning registration declared no locale.
 */
function shellText(t: WebuiTranslate | undefined, key: Parameters<WebuiTranslate>[0], fallback: string): string {
  return t?.(key) ?? fallback
}

/**
 * Normalize a thrown value so the card can always render a message.
 */
function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown))
}

/**
 * Hand a caught error's message and stack to the clipboard. A failure card may
 * never throw for a missing clipboard, so absence and rejection are both ignored.
 */
function copyErrorText(error: Error | undefined): void {
  if (error === undefined) return
  const text = error.stack === undefined ? error.message : `${error.message}\n${error.stack}`
  void navigator.clipboard?.writeText(text).catch(() => {})
}

/**
 * Show the crash of one region in place of its content, keeping siblings alive.
 */
export class RegionBoundary extends Component<RegionBoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: undefined }

  static getDerivedStateFromError(thrown: unknown): BoundaryState {
    return { error: toError(thrown) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${LOG_PREFIX} ${this.props.region}`, error, info.componentStack ?? '')
  }

  private readonly copy = (): void => {
    copyErrorText(this.state.error)
  }

  private readonly retry = (): void => {
    this.setState({ error: undefined })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children
    const { t } = this.props
    return (
      <div className="webui-error-card" role="alert">
        <p className="webui-error-title">{shellText(t, 'shell.error.regionTitle', 'This area failed to load')}</p>
        <pre className="webui-error-detail">{error.message}</pre>
        <div className="webui-error-actions">
          <button type="button" className="webui-error-action" onClick={this.copy}>
            {shellText(t, 'shell.error.copy', 'Copy error')}
          </button>
          <button type="button" className="webui-error-action" onClick={this.retry}>
            {shellText(t, 'shell.error.retry', 'Retry')}
          </button>
        </div>
      </div>
    )
  }
}

/**
 * Show a crash of the whole shell: the page explains itself instead of going
 * blank, and the reader can reload it.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: undefined }

  static getDerivedStateFromError(thrown: unknown): BoundaryState {
    return { error: toError(thrown) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${LOG_PREFIX} app`, error, info.componentStack ?? '')
  }

  private readonly copy = (): void => {
    copyErrorText(this.state.error)
  }

  private readonly reload = (): void => {
    window.location.reload()
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children
    const { t } = this.props
    return (
      <div className="webui-error-page" role="alert">
        <h1 className="webui-error-title">{shellText(t, 'shell.error.pageTitle', 'The page crashed')}</h1>
        <pre className="webui-error-detail">{error.message}</pre>
        <div className="webui-error-actions">
          <button type="button" className="webui-error-action" onClick={this.copy}>
            {shellText(t, 'shell.error.copy', 'Copy error')}
          </button>
          <button type="button" className="webui-error-action" onClick={this.reload}>
            {shellText(t, 'shell.error.reload', 'Reload')}
          </button>
        </div>
      </div>
    )
  }
}
