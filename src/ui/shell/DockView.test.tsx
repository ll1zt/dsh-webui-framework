// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import type {
  BlockLayoutActions,
  BlockMeta,
  LayoutNode,
  LayoutSize,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateBlock } from '../../lib/layout-ops.ts'
import type { BlockRegistration } from '../../client/services/block-registry.ts'
import type { BlockFailure } from '../../client/services/entry-errors.ts'
import type { WebuiTranslate } from '../../client/types.ts'
import { DockView, type DockViewProps } from './DockView.tsx'

const t = ((key: string) => key) as WebuiTranslate

function registration(id: string, over: Partial<BlockMeta> = {}): BlockRegistration {
  const meta: BlockMeta = {
    id,
    scope: 'root',
    priority: 0,
    title: { zh: `${id}-zh`, en: `${id}-en` },
    closable: true,
    multiInstance: false,
    ...over,
  }
  return { meta, component: () => null, owner: 'test' }
}

function pane(active: number, ...refs: [string, string?][]): LayoutNode {
  return { kind: 'pane', tabs: refs.map(([blockId, contentId]) => ({ blockId, contentId: contentId ?? '' })), active }
}

function layoutOf(root: LayoutNode | null): WebuiLayout {
  return { version: 1, root, activePane: [] }
}

const px = (value: number): LayoutSize => ({ px: value, min: 100, max: 600 })
const FR: LayoutSize = { fr: 1 }

function row(children: LayoutNode[], sizes: LayoutSize[]): LayoutNode {
  return { kind: 'split', axis: 'row', children, sizes }
}

function makeActions(): BlockLayoutActions {
  return { open: vi.fn(), close: vi.fn(), activate: vi.fn(), resize: vi.fn(), resetToPreset: vi.fn() }
}

const markerOf = (meta: BlockMeta, contentId: string): string =>
  `block-${meta.id}${contentId === '' ? '' : `:${contentId}`}`

function renderDock(
  layout: WebuiLayout,
  blocks: BlockRegistration[],
  {
    language = 'zh-CN',
    actions = makeActions(),
    failures,
    onRetry,
  }: {
    language?: string
    actions?: BlockLayoutActions
    failures?: ReadonlyMap<string, BlockFailure>
    onRetry?: (blockId: string) => void
  } = {},
) {
  const renderBlock = vi.fn<DockViewProps['renderBlock']>((meta, instance) => (
    <div data-testid={markerOf(meta, instance.contentId)}>{meta.id}</div>
  ))
  render(
    <DockView
      snapshot={{ layout, blocks }}
      actions={actions}
      renderBlock={renderBlock}
      t={t}
      language={language}
      {...(failures === undefined ? {} : { failures })}
      {...(onRetry === undefined ? {} : { onRetry })}
    />,
  )
  return { renderBlock, actions }
}

/** The nearest ancestor (or self) the split gave a flex size: the cell holding a pane. */
function cellOf(element: HTMLElement): HTMLElement {
  let node: HTMLElement | null = element
  while (node !== null && node.style.flexBasis === '' && node.style.flexGrow === '') node = node.parentElement
  if (node === null) throw new Error('no sized cell around the element')
  return node
}

afterEach(() => {
  cleanup()
})

describe('DockView', () => {
  it('A1 shows the dock.empty copy and no tab strip when the layout has no root', () => {
    renderDock(layoutOf(null), [registration('a')])

    expect(screen.getByText('dock.empty')).not.toBeNull()
    expect(screen.queryAllByRole('tablist')).toHaveLength(0)
  })

  it('A2 a row split of px 260 and fr 1 draws two cells with a tablist each and the active tab selected', () => {
    const layout = layoutOf(row([pane(1, ['a'], ['b']), pane(0, ['c'])], [px(260), FR]))
    renderDock(layout, [registration('a'), registration('b'), registration('c')])

    const lists = screen.getAllByRole('tablist')
    expect(lists).toHaveLength(2)
    const [first, second] = lists.map(cellOf)
    expect(first?.style.flexBasis).toBe('260px')
    expect(['', '0']).toContain(first?.style.flexGrow)
    expect(second?.style.flexGrow).toBe('1')

    const selected = (list: HTMLElement) =>
      within(list)
        .getAllByRole('tab')
        .map((tab) => tab.getAttribute('aria-selected'))
    expect(selected(lists[0] as HTMLElement)).toEqual(['false', 'true'])
    expect(selected(lists[1] as HTMLElement)).toEqual(['true'])
  })

  it('A2 tab titles follow the current language', () => {
    const layout = layoutOf(pane(0, ['a']))
    renderDock(layout, [registration('a')], { language: 'zh-CN' })
    expect(screen.getByRole('tab', { name: 'a-zh' })).not.toBeNull()
    cleanup()

    renderDock(layout, [registration('a')], { language: 'en' })
    expect(screen.getByRole('tab', { name: 'a-en' })).not.toBeNull()
  })

  it('A3 renderBlock gets the meta and the instance props for each registered tab, never a ctx, and skips an unregistered block', () => {
    const blocks = [registration('a'), registration('b')]
    const { renderBlock, actions } = renderDock(layoutOf(pane(0, ['a'], ['ghost'], ['b'])), blocks)

    expect(renderBlock).toHaveBeenCalledWith(blocks[0]?.meta, {
      blockId: 'a',
      contentId: '',
      active: true,
      layout: actions,
    })
    expect(renderBlock).toHaveBeenCalledWith(blocks[1]?.meta, {
      blockId: 'b',
      contentId: '',
      active: false,
      layout: actions,
    })
    expect(renderBlock.mock.calls.map(([meta]) => meta.id)).not.toContain('ghost')
    for (const [, instance] of renderBlock.mock.calls) expect(instance).not.toHaveProperty('ctx')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('A3 each cell shows only its own block', () => {
    const layout = layoutOf(row([pane(0, ['a']), pane(0, ['b'])], [px(260), FR]))
    renderDock(layout, [registration('a'), registration('b')])

    const [first, second] = screen.getAllByRole('tablist').map(cellOf)
    expect(within(first as HTMLElement).getByTestId('block-a')).not.toBeNull()
    expect(within(first as HTMLElement).queryByTestId('block-b')).toBeNull()
    expect(within(second as HTMLElement).getByTestId('block-b')).not.toBeNull()
    expect(within(second as HTMLElement).queryByTestId('block-a')).toBeNull()
  })

  it('A4 a closable:false tab has no close button, and the others close and activate with their target', () => {
    const blocks = [
      registration('pin', { closable: false }),
      registration('a'),
      registration('m', { multiInstance: true }),
    ]
    const { actions } = renderDock(layoutOf(pane(0, ['pin'], ['a'], ['m', 'x'])), blocks, { language: 'en' })

    const closers = screen.getAllByRole('button', { name: 'dock.tab.close' })
    expect(closers).toHaveLength(2)

    fireEvent.click(closers[0] as HTMLElement)
    expect(actions.close).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: 'a' }))
    fireEvent.click(closers[1] as HTMLElement)
    expect(actions.close).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: 'm', contentId: 'x' }))

    fireEvent.click(screen.getByRole('tab', { name: 'a-en' }))
    expect(actions.activate).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: 'a' }))
  })

  it('A5 switching tabs keeps the previous block mounted but hidden and its state alive', () => {
    function Counter({ label }: { label: string }): ReactNode {
      const [count, setCount] = useState(0)
      return (
        <div data-testid={`counter-${label}`}>
          <button type="button" onClick={() => setCount((value) => value + 1)}>{`inc-${label}`}</button>
          <output>{`${label}:${count}`}</output>
        </div>
      )
    }

    // A stateful host for the layout, so the same DockView instance sees the layout change.
    function Harness(): ReactNode {
      const [layout, setLayout] = useState(layoutOf(pane(0, ['a'], ['b'])))
      const actions: BlockLayoutActions = {
        ...makeActions(),
        activate: (target) => setLayout((current) => activateBlock(current, target)),
      }
      return (
        <DockView
          snapshot={{ layout, blocks: [registration('a'), registration('b')] }}
          actions={actions}
          renderBlock={(meta) => <Counter label={meta.id} />}
          t={t}
          language="en"
        />
      )
    }

    render(<Harness />)
    const counterA = screen.getByTestId('counter-a')
    expect(counterA.closest('[hidden]')).toBeNull()
    expect(screen.getByTestId('counter-b').closest('[hidden]')).not.toBeNull()

    fireEvent.click(screen.getByText('inc-a'))
    fireEvent.click(screen.getByText('inc-a'))
    expect(screen.getByText('a:2')).not.toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'b-en' }))
    expect(counterA.isConnected).toBe(true)
    expect(counterA.closest('[hidden]')).not.toBeNull()
    expect(screen.getByTestId('counter-b').closest('[hidden]')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'a-en' }))
    expect(screen.getByTestId('counter-a')).toBe(counterA)
    expect(counterA.closest('[hidden]')).toBeNull()
    expect(screen.getByText('a:2')).not.toBeNull()
    expect(screen.getByTestId('counter-b').closest('[hidden]')).not.toBeNull()
  })
})

describe('DockView block failures', () => {
  const failures = new Map<string, BlockFailure>([['X', { blockId: 'X', error: new Error('x exploded') }]])
  const twoPanes = layoutOf(row([pane(0, ['X']), pane(0, ['Y'])], [FR, FR]))
  const blocks = [registration('X'), registration('Y')]

  it('A1 a failed block shows an error card in its cell while the other cell still renders its block', () => {
    const { renderBlock } = renderDock(twoPanes, blocks, { failures, language: 'en' })

    const [first, second] = screen.getAllByRole('tablist').map(cellOf)
    const card = within(first as HTMLElement).getByRole('alert')
    expect(card.textContent).toContain('x exploded')
    expect(card.textContent).toContain('X-en')
    expect(within(first as HTMLElement).queryByTestId('block-X')).toBeNull()
    expect(within(second as HTMLElement).queryByRole('alert')).toBeNull()
    expect(within(second as HTMLElement).getByTestId('block-Y')).not.toBeNull()
    expect(renderBlock.mock.calls.map(([meta]) => meta.id)).toEqual(['Y'])
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('A1 without failures every block renders and there is no alert', () => {
    const { renderBlock } = renderDock(twoPanes, blocks)

    expect(screen.queryByRole('alert')).toBeNull()
    expect(renderBlock.mock.calls.map(([meta]) => meta.id)).toEqual(['X', 'Y'])
  })

  it('A3 retry in the card of the failed block calls onRetry with its id', () => {
    const onRetry = vi.fn()
    renderDock(twoPanes, blocks, { failures, onRetry })

    fireEvent.click(screen.getByRole('button', { name: 'shell.error.retry' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith('X')
  })

  it('A3 without onRetry the card has no retry button', () => {
    renderDock(twoPanes, blocks, { failures })

    expect(screen.getByRole('alert')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'shell.error.retry' })).toBeNull()
  })
})
