/** The whole-page frame: a full-height sidebar beside topbar-over-main, plus the optional right column and overlay. */
import type { ReactNode } from 'react'
import { RegionBoundary } from './ErrorBoundary.tsx'
import './shell.css'

/** Copy seat of the shell; the root registration's `locale` option provides it. */
type ShellTranslate = (key: string) => string

/** Props of {@link AppShell}: every region is a fully composed subtree supplied by the owner. */
export interface AppShellProps {
  sidebar: ReactNode
  topbar: ReactNode
  main: ReactNode
  right?: ReactNode
  overlay?: ReactNode
  t?: ShellTranslate | undefined
}

/**
 * Lay out the shell regions. Each region element stays outside its boundary, so
 * a crash replaces only the content: the column keeps its geometry and the area
 * stays addressable while it shows the error card.
 * @param props - region content and the copy seat.
 * @returns the composed frame.
 */
export function AppShell({ sidebar, topbar, main, right, overlay, t }: AppShellProps): ReactNode {
  return (
    <div className="webui-shell">
      <div className="webui-sidebar" data-region="sidebar">
        <RegionBoundary region="sidebar" t={t}>
          {sidebar}
        </RegionBoundary>
      </div>
      <div className="webui-center">
        <header className="webui-topbar" data-region="topbar">
          <RegionBoundary region="topbar" t={t}>
            {topbar}
          </RegionBoundary>
        </header>
        <div className="webui-main" data-region="main">
          <RegionBoundary region="main" t={t}>
            {main}
          </RegionBoundary>
        </div>
      </div>
      {right === undefined ? null : (
        <aside className="webui-right" data-region="right">
          <RegionBoundary region="right" t={t}>
            {right}
          </RegionBoundary>
        </aside>
      )}
      {overlay === undefined ? null : <div className="webui-overlay">{overlay}</div>}
    </div>
  )
}
