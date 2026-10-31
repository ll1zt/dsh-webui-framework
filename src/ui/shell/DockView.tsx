/** Draws the layout tree: splits as flex rows or columns, panes as a tab strip over their mounted blocks. */
import { useRef, type CSSProperties, type ReactNode } from 'react'
import type {
  BlockInstanceProps,
  BlockLayoutActions,
  BlockMeta,
  LayoutNode,
  LayoutPane,
  LayoutSize,
  LayoutSplit,
} from '@lllzt/dsh-webui-framework/contract'
import type { BlockRegistration } from '../../client/services/block-registry.ts'
import type { BlockFailure } from '../../client/services/entry-errors.ts'
import type { DockActions, DockSnapshot } from '../../client/services/layout-controller.ts'
import type { WebuiTranslate } from '../../client/types.ts'
import { BlockErrorCard } from './ErrorBoundary.tsx'
import { Splitter } from './Splitter.tsx'
import './dock.css'

export interface DockViewProps {
  snapshot: DockSnapshot
  /** `resizeSplit` is what the splitters call; without it they still render but resize nothing. */
  actions: BlockLayoutActions & Partial<Pick<DockActions, 'resizeSplit'>>
  renderBlock: (meta: BlockMeta, instance: BlockInstanceProps) => ReactNode
  t: WebuiTranslate
  language: string
  /** Blocks whose entry failed to render; their tab panel shows an error card instead of the block. */
  failures?: ReadonlyMap<string, BlockFailure>
  /** Retry a failed block; without it the error card has no retry button. */
  onRetry?: (blockId: string) => void
}

type DockContext = Omit<DockViewProps, 'snapshot'> & { metas: ReadonlyMap<string, BlockMeta> }

const FILL: LayoutSize = { fr: 1 }

function sizeStyle(size: LayoutSize = FILL): CSSProperties {
  if ('px' in size) return { flexBasis: `${size.px}px`, flexGrow: 0, flexShrink: 0 }
  return { flexBasis: 0, flexGrow: size.fr, flexShrink: 1 }
}

function titleOf(meta: BlockMeta, language: string): string {
  return language.startsWith('zh') ? meta.title.zh : meta.title.en
}

function Pane({ pane, dock }: { pane: LayoutPane; dock: DockContext }): ReactNode {
  const { actions, renderBlock, t, language, metas, failures, onRetry } = dock
  // Tabs keep their index in the layout, so `active` still lines up when an unregistered block is skipped.
  const tabs = pane.tabs.flatMap((ref, index) => {
    const meta = metas.get(ref.blockId)
    return meta === undefined ? [] : [{ ref, meta, active: index === pane.active }]
  })
  const contentOf = (ref: LayoutPane['tabs'][number], meta: BlockMeta, active: boolean): ReactNode => {
    const failure = failures?.get(ref.blockId)
    if (failure === undefined) {
      return renderBlock(meta, { blockId: ref.blockId, contentId: ref.contentId, active, layout: actions })
    }
    return (
      <BlockErrorCard
        failure={failure}
        title={titleOf(meta, language)}
        {...(onRetry === undefined ? {} : { onRetry: () => onRetry(ref.blockId) })}
        t={t}
      />
    )
  }
  return (
    <div className="webui-dock-pane">
      <div className="webui-dock-tabs" role="tablist">
        {tabs.map(({ ref, meta, active }) => (
          <div
            key={`${ref.blockId}\u0000${ref.contentId}`}
            className="webui-dock-tab"
            data-active={active}
            role="presentation"
          >
            <button
              type="button"
              role="tab"
              className="webui-dock-tab-button"
              aria-selected={active}
              onClick={() => actions.activate(ref)}
            >
              {titleOf(meta, language)}
            </button>
            {meta.closable && (
              <button
                type="button"
                className="webui-dock-tab-close"
                aria-label={t('dock.tab.close')}
                onClick={() => actions.close(ref)}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="webui-dock-panels">
        {tabs.map(({ ref, meta, active }) => (
          <div
            key={`${ref.blockId}\u0000${ref.contentId}`}
            className="webui-dock-panel"
            role="tabpanel"
            aria-label={titleOf(meta, language)}
            hidden={!active}
          >
            {contentOf(ref, meta, active)}
          </div>
        ))}
      </div>
    </div>
  )
}

function Split({ split, path, dock }: { split: LayoutSplit; path: readonly number[]; dock: DockContext }): ReactNode {
  const element = useRef<HTMLDivElement>(null)
  const containerPx = (): number => {
    const box = element.current?.getBoundingClientRect()
    return (split.axis === 'row' ? box?.width : box?.height) ?? 0
  }
  return (
    <div ref={element} className="webui-dock-split" style={{ flexDirection: split.axis }}>
      {split.children.flatMap((child, index) => [
        // A layout is rewritten whole, so a child keeps its slot index and nothing else identifies it.
        ...(index === 0
          ? []
          : [
              <Splitter
                key={`splitter-${index - 1}`}
                split={split}
                index={index - 1}
                containerPx={containerPx}
                onResize={(next) => dock.actions.resizeSplit?.(path, next.sizes)}
                label={dock.t('dock.splitter')}
              />,
            ]),
        <div key={`cell-${index}`} className="webui-dock-cell" style={sizeStyle(split.sizes[index])}>
          <Node node={child} path={[...path, index]} dock={dock} />
        </div>,
      ])}
    </div>
  )
}

function Node({ node, path, dock }: { node: LayoutNode; path: readonly number[]; dock: DockContext }): ReactNode {
  if (node.kind === 'pane') return <Pane pane={node} dock={dock} />
  return <Split split={node} path={path} dock={dock} />
}

/**
 * The dock: renders `snapshot.layout`, one `renderBlock` call per open tab of a registered block.
 * Inactive tabs stay mounted and hidden, so switching tabs keeps a block's own state.
 */
export function DockView({ snapshot, ...dock }: DockViewProps): ReactNode {
  const { root } = snapshot.layout
  if (root === null) return <div className="webui-dock-empty">{dock.t('dock.empty')}</div>
  const metas = new Map(snapshot.blocks.map((block: BlockRegistration) => [block.meta.id, block.meta]))
  return (
    <div className="webui-dock">
      <Node node={root} path={[]} dock={{ ...dock, metas }} />
    </div>
  )
}
