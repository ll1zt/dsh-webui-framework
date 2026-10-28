/** The `root` slot component: the whole-page owner (docs/02 §6). */
import type { CSSProperties, ReactNode } from 'react'
import type { PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { PageStoreHandle } from '../services/page-store.ts'
import type {} from '../types.ts'
import { AppShell } from '../../ui/shell/AppShell.tsx'
import { AppErrorBoundary } from '../../ui/shell/ErrorBoundary.tsx'

/** Sidebar width published to the stylesheet as pi-web's `--sidebar-width`. */
type FrameStyle = CSSProperties & Record<'--sidebar-width', string>

/**
 * Props the `root` registration composes: the store seat plus the `webui` copy
 * seat. `t` is namespace-bound at the registration site; the frame only needs
 * text for a key, so it is stated as that plain shape.
 */
interface AppProps extends PropsRuntime<'root'>, PropsStore<PageStoreHandle> {
  t(key: string): string
}

/**
 * Compose the page frame. The regions hold placeholders until their own units
 * land; the width preference rides a custom property so the stylesheet keeps
 * owning the geometry.
 * @param props - framework-injected store and locale seats.
 * @returns the whole page.
 */
export function App({ t, useStore }: AppProps): ReactNode {
  const sidebarWidth = useStore((state) => state.sidebarWidth)
  const style: FrameStyle = { '--sidebar-width': `${sidebarWidth}px` }
  return (
    <div className="webui-root" style={style}>
      <AppErrorBoundary t={t}>
        <AppShell
          t={t}
          sidebar={<div className="webui-placeholder" />}
          topbar={<div className="webui-placeholder" />}
          main={<div className="webui-placeholder" />}
        />
      </AppErrorBoundary>
    </div>
  )
}
