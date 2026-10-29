/** The `root` slot component: the whole-page owner. */
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PageStoreHandle } from '../services/page-store.ts'
import type {} from '../types.ts'
import { AppErrorBoundary } from '../../ui/shell/ErrorBoundary.tsx'

/** Props the `root` registration composes: runtime, store seat and the `webui` copy seat. */
type AppProps = PropsRuntime<'root'> & PropsStore<PageStoreHandle> & PropsLocale<'webui'>

/**
 * The root registration's component: an empty root container behind the
 * whole-page boundary, so a crash in the page's own render shows the error panel
 * instead of a blank page.
 */
export function App({ t }: AppProps): ReactNode {
  return (
    <AppErrorBoundary t={t}>
      <div className="webui-root" />
    </AppErrorBoundary>
  )
}
