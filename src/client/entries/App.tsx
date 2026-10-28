/** The `root` slot component: the whole-page owner (docs/02 §6). */
import type { CSSProperties, ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PageStoreHandle } from '../services/page-store.ts'
import type {} from '../types.ts'
import { AppShell } from '../../ui/shell/AppShell.tsx'
import { AppErrorBoundary } from '../../ui/shell/ErrorBoundary.tsx'

/** Sidebar width published to the stylesheet as pi-web's `--sidebar-width`. */
type FrameStyle = CSSProperties & Record<'--sidebar-width', string>

/** Props the `root` registration composes: runtime, store seat and the `webui` copy seat. */
type AppProps = PropsRuntime<'root'> & PropsStore<PageStoreHandle> & PropsLocale<'webui'>

/**
 * Compose the page frame. The regions hold placeholders until their own units
 * land; the width preference rides a custom property so the stylesheet keeps
 * owning the geometry.
 * @param props - framework-injected store and locale seats.
 * @returns the whole page.
 */
function AppBody({ t, useStore }: AppProps): ReactNode {
  const sidebarWidth = useStore((state) => state.sidebarWidth)
  const style: FrameStyle = { '--sidebar-width': `${sidebarWidth}px` }
  return (
    <div className="webui-root" style={style}>
      <AppShell
        t={t}
        sidebar={<div className="webui-placeholder" />}
        topbar={<div className="webui-placeholder" />}
        main={<div className="webui-placeholder" />}
      />
    </div>
  )
}

/**
 * The root registration's component: the frame behind the whole-page boundary,
 * so a crash in the frame's own render shows the error panel instead of a blank page.
 * @param props - framework-injected store and locale seats.
 * @returns the whole page, or the whole-page error panel.
 */
export function App(props: AppProps): ReactNode {
  return (
    <AppErrorBoundary t={props.t}>
      <AppBody {...props} />
    </AppErrorBoundary>
  )
}
