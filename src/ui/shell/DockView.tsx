/** Draws the layout tree: splits as flex rows or columns, panes as a tab strip over their mounted blocks. */
import { useRef, type CSSProperties, type ReactNode } from 'react'
import type {
  BlockInstanceProps,
  BlockLayoutActions,
  BlockMeta,
  BlockRef,
  BlockTabHandle,
  LayoutNode,
  LayoutPane,
  LayoutSize,
  LayoutSplit,
  LayoutView,
  LocalizedText,
} from '@lllzt/dsh-webui-framework/contract'
import type { BlockRegistration } from '../../client/services/block-registry.ts'
import type { BlockFailure } from '../../client/services/entry-errors.ts'
import { tabKey, type DockActions, type DockSnapshot } from '../../client/services/layout-controller.ts'
import type { WebuiTranslate } from '../../client/types.ts'
import { localizedTextFor } from '../../lib/localized-text.ts'
import { BlockErrorCard } from './ErrorBoundary.tsx'
import { PANE_ATTRIBUTE } from './pane-dom.ts'
import { Splitter } from './Splitter.tsx'
import './dock.css'

export interface DockViewProps {
  /** `titles` may be left out when no tab has a title of its own. */
  snapshot: Omit<DockSnapshot, 'titles'> & Partial<Pick<DockSnapshot, 'titles'>>
  /**
   * `resizeSplit` is what the splitters call; without it they still render but resize nothing.
   * Without `setTabTitle`, `props.tab.setTitle` does nothing; without `setCloseGuard`, `props.tab.setCloseGuard` does nothing.
   */
  actions: BlockLayoutActions &
    Partial<Pick<DockActions, 'resizeSplit' | 'beginResize' | 'endResize' | 'setTabTitle' | 'setCloseGuard'>>
  renderBlock: (meta: BlockMeta, instance: BlockInstanceProps) => ReactNode
  /** The read-only layout view every block instance gets as `props.view`. */
  view: LayoutView
  t: WebuiTranslate
  language: string
  /** Blocks whose entry failed to render; their tab panel shows an error card instead of the block. */
  failures?: ReadonlyMap<string, BlockFailure>
  /** Retry a failed block; without it the error card has no retry button. */
  onRetry?: (blockId: string) => void
  /**
   * Host binding of a `session`-scope block's body, e.g. a session area that falls back to an empty
   * body. Only that body is wrapped: the tab strip, the error card and `root` blocks stay outside.
   */
  wrapSession?: (children: ReactNode) => ReactNode
}

type DockContext = Omit<DockViewProps, 'snapshot'> & {
  metas: ReadonlyMap<string, BlockMeta>
  /** What blocks get as `props.layout`: the seven block actions and nothing else of `actions`. */
  layout: BlockLayoutActions
  /** The titles tabs gave themselves, by `tabKey`. */
  titles: ReadonlyMap<string, LocalizedText>
}

const blockLayouts = new WeakMap<object, BlockLayoutActions>()

/**
 * The seven block actions of `actions`, the same object for the same `actions`, so blocks never see `resizeSplit` and friends.
 * Each one forwards to the method of the same name with `actions` as `this`, so methods that use `this` work too.
 */
function blockLayoutOf(actions: BlockLayoutActions): BlockLayoutActions {
  let layout = blockLayouts.get(actions)
  if (layout === undefined) {
    layout = {
      open: (target, placement) => (placement === undefined ? actions.open(target) : actions.open(target, placement)),
      close: (target) => actions.close(target),
      activate: (target) => actions.activate(target),
      resize: (target, size) => actions.resize(target, size),
      resetToPreset: () => actions.resetToPreset(),
      undo: () => actions.undo(),
      redo: () => actions.redo(),
    }
    blockLayouts.set(actions, layout)
  }
  return layout
}

const tabHandles = new WeakMap<object, Map<string, BlockTabHandle>>()

/** The handle of tab `ref`, the same object for the same `actions` and tab; `setTitle` and `setCloseGuard` forward to `actions.setTabTitle` and `actions.setCloseGuard`. */
function tabHandleOf(actions: DockViewProps['actions'], ref: BlockRef): BlockTabHandle {
  let handles = tabHandles.get(actions)
  if (handles === undefined) {
    handles = new Map()
    tabHandles.set(actions, handles)
  }
  const key = tabKey(ref)
  let handle = handles.get(key)
  if (handle === undefined) {
    const tabRef: BlockRef = { blockId: ref.blockId, contentId: ref.contentId }
    handle = {
      setTitle: (title) => actions.setTabTitle?.(tabRef, title),
      setCloseGuard: (guard) => actions.setCloseGuard?.(tabRef, guard),
    }
    handles.set(key, handle)
  }
  return handle
}

const FILL: LayoutSize = { fr: 1 }

function sizeStyle(size: LayoutSize = FILL): CSSProperties {
  if ('px' in size) return { flexBasis: `${size.px}px`, flexGrow: 0, flexShrink: 0 }
  return { flexBasis: 0, flexGrow: size.fr, flexShrink: 1 }
}

/** The tab's own title when it has one, else the block's. */
function titleOf(meta: BlockMeta, tabTitle: LocalizedText | undefined, language: string): string {
  return localizedTextFor(tabTitle ?? meta.title, language)
}

function Pane({ pane, path, dock }: { pane: LayoutPane; path: readonly number[]; dock: DockContext }): ReactNode {
  const { actions, layout, renderBlock, view, t, language, metas, titles, failures, onRetry, wrapSession } = dock
  // Tabs keep their index in the layout, so `active` still lines up when an unregistered block is skipped.
  const tabs = pane.tabs.flatMap((ref, index) => {
    const meta = metas.get(ref.blockId)
    return meta === undefined ? [] : [{ ref, meta, active: index === pane.active }]
  })
  const contentOf = (ref: LayoutPane['tabs'][number], meta: BlockMeta, active: boolean): ReactNode => {
    const failure = failures?.get(ref.blockId)
    if (failure === undefined) {
      const body = renderBlock(meta, {
        blockId: ref.blockId,
        contentId: ref.contentId,
        active,
        layout,
        tab: tabHandleOf(actions, ref),
        view,
      })
      return meta.scope === 'session' && wrapSession !== undefined ? wrapSession(body) : body
    }
    return (
      <BlockErrorCard
        failure={failure}
        title={titleOf(meta, titles.get(tabKey(ref)), language)}
        {...(onRetry === undefined ? {} : { onRetry: () => onRetry(ref.blockId) })}
        t={t}
      />
    )
  }
  return (
    <div className="webui-dock-pane" {...{ [PANE_ATTRIBUTE]: path.join('.') }}>
      <div className="webui-dock-tabs" role="tablist">
        {tabs.map(({ ref, meta, active }) => (
          <div key={tabKey(ref)} className="webui-dock-tab" data-active={active} role="presentation">
            <button
              type="button"
              role="tab"
              className="webui-dock-tab-button"
              aria-selected={active}
              onClick={() => actions.activate(ref)}
            >
              {titleOf(meta, titles.get(tabKey(ref)), language)}
            </button>
            {meta.closable && (
              <button
                type="button"
                className="webui-dock-tab-close"
                aria-label={t('dock.tab.close', { title: titleOf(meta, titles.get(tabKey(ref)), language) })}
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
            key={tabKey(ref)}
            className="webui-dock-panel"
            role="tabpanel"
            aria-label={titleOf(meta, titles.get(tabKey(ref)), language)}
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
                onResizeStart={() => dock.actions.beginResize?.()}
                onResizeEnd={() => dock.actions.endResize?.()}
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
  if (node.kind === 'pane') return <Pane pane={node} path={path} dock={dock} />
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
      <Node
        node={root}
        path={[]}
        dock={{ ...dock, metas, titles: snapshot.titles ?? new Map(), layout: blockLayoutOf(dock.actions) }}
      />
    </div>
  )
}
