/** The `root` slot component: the whole-page owner. */
import type { ReactNode } from 'react'
import type { LocaleSnapshot } from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { BlockLayoutActions, BlockInstanceProps, BlockMeta } from '@lllzt/dsh-webui-framework/contract'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { AppErrorBoundary } from '../../ui/shell/ErrorBoundary.tsx'
import { DockView } from '../../ui/shell/DockView.tsx'
import type { BlockFailure } from '../services/entry-errors.ts'
import type { DockSnapshot } from '../services/layout-controller.ts'
import { WEBUI_SLOT_KEYS } from '../types.ts'
import '../../ui/shell/shell.css'

type BlockSlotKey = (typeof WEBUI_SLOT_KEYS)[keyof typeof WEBUI_SLOT_KEYS]

/** What the root registration's inject factory hands over: the dock, locale and failure sources, the layout actions and the retry. */
export interface AppInject {
  hooks: {
    dock: ObservableSnapshot<DockSnapshot>
    locale: ObservableSnapshot<LocaleSnapshot>
    errors: ObservableSnapshot<ReadonlyMap<string, BlockFailure>>
  }
  dockActions: BlockLayoutActions
  retryBlock: (blockId: string) => void
}

/** Props the `root` registration composes: runtime, the `webui` copy seat, the block lists and the injected dock. */
type AppProps = PropsRuntime<'root'> & PropsLocale<'webui'> & PropsRenderSlots<BlockSlotKey> & InjectFace<AppInject>

/**
 * The root registration's component: the dock behind the whole-page boundary, so a crash in the
 * page's own render shows the error panel instead of a blank page. Every block is mounted through
 * the slot of its scope; the main session binds only the `session` blocks, so a page without one
 * still draws the rest of the dock.
 */
export function App({
  t,
  useDock,
  useLocale,
  useErrors,
  dockActions,
  retryBlock,
  renderSlot,
  SessionProvider,
}: AppProps): ReactNode {
  const snapshot = useDock((current) => current)
  const language = useLocale((current) => current.active)
  const failures = useErrors((current) => current)
  const renderBlock = (meta: BlockMeta, instance: BlockInstanceProps): ReactNode =>
    renderSlot(WEBUI_SLOT_KEYS[meta.scope], instance, {
      only: meta.id,
      fallback:
        meta.scope === 'session' ? <div className="webui-dock-session-empty">{t('dock.session.empty')}</div> : null,
    })
  return (
    <AppErrorBoundary t={t}>
      <div className="webui-root">
        <DockView
          snapshot={snapshot}
          actions={dockActions}
          renderBlock={renderBlock}
          t={t}
          language={language}
          failures={failures}
          onRetry={retryBlock}
          wrapSession={(children) => (
            <SessionProvider empty={() => <div className="webui-dock-session-empty">{t('dock.session.empty')}</div>}>
              {children}
            </SessionProvider>
          )}
        />
      </div>
    </AppErrorBoundary>
  )
}
