/** Draws the layout tree: splits as flex rows or columns, panes as a tab strip over their mounted blocks. */
import type { CSSProperties, ReactNode } from 'react'
import type {
  BlockInstanceProps,
  BlockLayoutActions,
  BlockMeta,
  LayoutNode,
  LayoutPane,
  LayoutSize,
} from '@lllzt/dsh-webui-framework/contract'
import type { BlockRegistration } from '../../client/services/block-registry.ts'
import type { DockSnapshot } from '../../client/services/layout-controller.ts'
import type { WebuiTranslate } from '../../client/types.ts'
import './dock.css'

export interface DockViewProps {
  snapshot: DockSnapshot
  actions: BlockLayoutActions
  renderBlock: (meta: BlockMeta, instance: BlockInstanceProps) => ReactNode
  t: WebuiTranslate
  language: string
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
  const { actions, renderBlock, t, language, metas } = dock
  // Tabs keep their index in the layout, so `active` still lines up when an unregistered block is skipped.
  const tabs = pane.tabs.flatMap((ref, index) => {
    const meta = metas.get(ref.blockId)
    return meta === undefined ? [] : [{ ref, meta, active: index === pane.active }]
  })
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
            {renderBlock(meta, { blockId: ref.blockId, contentId: ref.contentId, active, layout: actions })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Node({ node, dock }: { node: LayoutNode; dock: DockContext }): ReactNode {
  if (node.kind === 'pane') return <Pane pane={node} dock={dock} />
  return (
    <div className="webui-dock-split" style={{ flexDirection: node.axis }}>
      {node.children.map((child, index) => (
        // A layout is rewritten whole, so a child keeps its slot index and nothing else identifies it.
        <div key={index} className="webui-dock-cell" style={sizeStyle(node.sizes[index])}>
          <Node node={child} dock={dock} />
        </div>
      ))}
    </div>
  )
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
      <Node node={root} dock={{ ...dock, metas }} />
    </div>
  )
}
