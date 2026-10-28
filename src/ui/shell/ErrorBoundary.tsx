/**
 * The shell's two failure faces: a per-region card that leaves the rest of the
 * page alive, and a whole-page panel for a crash above every region. These are
 * the package's only class components — catching a render error is the one
 * thing hooks cannot do.
 */
import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'

/** The shell areas a crash can be contained to. */
export type RegionName = 'sidebar' | 'topbar' | 'main' | 'right' | 'composer' | 'dialogs'

/** Diagnostic prefix of every caught crash. */
const LOG_PREFIX = '[dsh-web-ui]'

/** Copy seat of the shell; the root registration's `locale` option provides it. */
type ShellTranslate = (key: string) => string

/** Props of {@link RegionBoundary}. */
export interface RegionBoundaryProps {
  region: RegionName
  children: ReactNode
  t?: ShellTranslate | undefined
}

/** Props of {@link AppErrorBoundary}. */
interface AppErrorBoundaryProps {
  children: ReactNode
  t?: ShellTranslate | undefined
}

interface RegionBoundaryState {
  error: Error | undefined
  /** Bumped per retry: the new key remounts the failed subtree from scratch. */
  attempt: number
}

interface AppErrorBoundaryState {
  error: Error | undefined
}

/**
 * Resolve copy through the injected seat, falling back to English.
 * @param t - copy seat, absent when the owning registration declared no locale.
 * @param key - dictionary key.
 * @param fallback - English text used when there is no seat.
 * @returns the text to show.
 */
function shellText(t: ShellTranslate | undefined, key: string, fallback: string): string {
  return t?.(key) ?? fallback
}

/**
 * Normalize a thrown value so the card can always render a message.
 * @param thrown - whatever the subtree threw.
 * @returns an Error carrying at least a message.
 */
function toError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(String(thrown))
}

/**
 * Hand the message and stack to the clipboard. A failure card may never throw
 * for a missing clipboard, so absence and rejection are both ignored.
 * @param error - the caught error.
 */
function copyErrorText(error: Error): void {
  const text = error.stack === undefined ? error.message : `${error.message}\n${error.stack}`
  void navigator.clipboard?.writeText(text).catch(() => {})
}

/**
 * Show the crash of one region in place of its content, keeping siblings alive.
 * @param props - the region name, its content, and the copy seat.
 * @returns the region content, or the error card.
 */
export class RegionBoundary extends Component<RegionBoundaryProps, RegionBoundaryState> {
  override state: RegionBoundaryState = { error: undefined, attempt: 0 }

  static getDerivedStateFromError(thrown: unknown): Pick<RegionBoundaryState, 'error'> {
    return { error: toError(thrown) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${LOG_PREFIX} ${this.props.region}`, error, info.componentStack ?? '')
  }

  private readonly copy = (): void => {
    const { error } = this.state
    if (error === undefined) return
    copyErrorText(error)
  }

  private readonly retry = (): void => {
    this.setState((state) => ({ error: undefined, attempt: state.attempt + 1 }))
  }

  override render(): ReactNode {
    const { error, attempt } = this.state
    if (error === undefined) return <Fragment key={attempt}>{this.props.children}</Fragment>
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
 * @param props - the page content and the copy seat.
 * @returns the page content, or the whole-page error panel.
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: undefined }

  static getDerivedStateFromError(thrown: unknown): Pick<AppErrorBoundaryState, 'error'> {
    return { error: toError(thrown) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`${LOG_PREFIX} app`, error, info.componentStack ?? '')
  }

  private readonly copy = (): void => {
    const { error } = this.state
    if (error === undefined) return
    copyErrorText(error)
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
