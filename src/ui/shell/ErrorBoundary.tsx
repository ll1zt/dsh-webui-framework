/**
 * The shell's two failure faces: a per-block card that leaves the rest of the
 * page alive, and a whole-page panel for a crash above every block. The page
 * panel is the package's only class component — catching a render error is the
 * one thing hooks cannot do. The per-block card needs no boundary: the host
 * wraps every slot entry itself and reports the failure.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import type { BlockFailure } from '../../client/services/entry-errors.ts'
import { LOG_PREFIX } from '../../client/services/log-prefix.ts'
import type { WebuiTranslate } from '../../client/types.ts'

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

export interface BlockErrorCardProps {
  failure: BlockFailure
  /** The failed block's title in the current language. */
  title: string
  /** Retry the block; the button shows only when given. */
  onRetry?: () => void
  t: WebuiTranslate
}

/**
 * Show a block's failure in place of the block, keeping every other cell alive.
 */
export function BlockErrorCard({ failure, title, onRetry, t }: BlockErrorCardProps): ReactNode {
  return (
    <div className="webui-error-card" role="alert">
      <p className="webui-error-title">{t('shell.error.blockTitle')}</p>
      <p>{title}</p>
      <pre className="webui-error-detail">{failure.error.message}</pre>
      <div className="webui-error-actions">
        <button type="button" className="webui-error-action" onClick={() => copyErrorText(failure.error)}>
          {t('shell.error.copy')}
        </button>
        {onRetry !== undefined && (
          <button type="button" className="webui-error-action" onClick={onRetry}>
            {t('shell.error.retry')}
          </button>
        )}
      </div>
    </div>
  )
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
