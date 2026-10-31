// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { isValidElement, useEffect, useState, type ReactNode } from 'react'
import type {
  BlockLayoutActions,
  BlockMeta,
  BlockTarget,
  LayoutActionResult,
  LayoutNode,
  LocalizedText,
  LayoutSize,
  WebuiLayout,
} from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../locale/en.json'
import zh from '../../../locale/zh.json'
import { activateBlock } from '../../lib/layout-ops.ts'
import type { BlockRegistration } from '../../client/services/block-registry.ts'
import type { BlockFailure } from '../../client/services/entry-errors.ts'
import type { WebuiTranslate } from '../../client/types.ts'
import { tabKey } from '../../client/services/layout-controller.ts'
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
    wrapSession,
    translate = t,
    titles,
  }: {
    language?: string
    actions?: DockViewProps['actions']
    failures?: ReadonlyMap<string, BlockFailure>
    onRetry?: (blockId: string) => void
    wrapSession?: DockViewProps['wrapSession']
    translate?: WebuiTranslate
    titles?: ReadonlyMap<string, LocalizedText>
  } = {},
) {
  const renderBlock = vi.fn<DockViewProps['renderBlock']>((meta, instance) => (
    <div data-testid={markerOf(meta, instance.contentId)}>{meta.id}</div>
  ))
  render(
    <DockView
      snapshot={{ layout, blocks, ...(titles === undefined ? {} : { titles }) }}
      actions={actions}
      renderBlock={renderBlock}
      t={translate}
      language={language}
      {...(failures === undefined ? {} : { failures })}
      {...(onRetry === undefined ? {} : { onRetry })}
      {...(wrapSession === undefined ? {} : { wrapSession })}
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
    const { renderBlock } = renderDock(layoutOf(pane(0, ['a'], ['ghost'], ['b'])), blocks)

    expect(renderBlock).toHaveBeenCalledWith(blocks[0]?.meta, {
      blockId: 'a',
      contentId: '',
      active: true,
      layout: expect.any(Object),
      tab: expect.any(Object),
    })
    expect(renderBlock).toHaveBeenCalledWith(blocks[1]?.meta, {
      blockId: 'b',
      contentId: '',
      active: false,
      layout: expect.any(Object),
      tab: expect.any(Object),
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
        activate: (target) => {
          setLayout((current) => activateBlock(current, target))
          return { ok: true }
        },
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

describe('DockView session wrapping', () => {
  const rootBlock = registration('r', { scope: 'root' })
  const sessionBlock = registration('s', { scope: 'session' })
  const rootMarker = markerOf(rootBlock.meta, '')
  const sessionMarker = markerOf(sessionBlock.meta, '')

  it('A1 a root-scope block still renders and dock.empty still shows when nothing has a main session', () => {
    const wrapSession = vi.fn<NonNullable<DockViewProps['wrapSession']>>(() => <div>dock.session.empty</div>)
    const { renderBlock } = renderDock(layoutOf(pane(0, ['r'])), [rootBlock], { wrapSession })

    expect(renderBlock).toHaveBeenCalledTimes(1)
    expect(renderBlock.mock.calls[0]?.[0].id).toBe('r')
    expect(screen.getByTestId(rootMarker).textContent).toBe('r')
    expect(wrapSession).not.toHaveBeenCalled()
    cleanup()

    renderDock(layoutOf(null), [rootBlock], { wrapSession })
    expect(screen.getByText('dock.empty')).not.toBeNull()
    expect(wrapSession).not.toHaveBeenCalled()
  })

  it('A2 only the session block goes through wrapSession and shows the session empty copy without a session', () => {
    const layout = layoutOf(row([pane(0, ['r']), pane(0, ['s'])], [FR, FR]))
    const blocks = [rootBlock, sessionBlock]
    const wrapSession = vi.fn<NonNullable<DockViewProps['wrapSession']>>(() => <div>dock.session.empty</div>)
    const { renderBlock } = renderDock(layout, blocks, { wrapSession })

    expect(wrapSession).toHaveBeenCalledTimes(1)
    const [content] = wrapSession.mock.calls[0] ?? []
    expect(isValidElement<{ 'data-testid'?: string }>(content) ? content.props['data-testid'] : undefined).toBe(
      sessionMarker,
    )
    expect(screen.getByText('dock.session.empty')).not.toBeNull()
    expect(screen.queryByTestId(sessionMarker)).toBeNull()
    expect(screen.getByTestId(rootMarker)).not.toBeNull()
    expect(renderBlock.mock.calls.map(([meta]) => meta.id)).toEqual(['r', 's'])
    cleanup()

    const passThrough = vi.fn<NonNullable<DockViewProps['wrapSession']>>((children: ReactNode) => <>{children}</>)
    renderDock(layout, blocks, { wrapSession: passThrough })

    expect(passThrough).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId(sessionMarker)).not.toBeNull()
    expect(screen.getByTestId(rootMarker)).not.toBeNull()
  })

  it('A3 the error card of a failed session block is never wrapped', () => {
    const failures = new Map<string, BlockFailure>([['s', { blockId: 's', error: new Error('s exploded') }]])
    const wrapSession = vi.fn<NonNullable<DockViewProps['wrapSession']>>((children: ReactNode) => <>{children}</>)
    renderDock(layoutOf(pane(0, ['s'])), [sessionBlock], { failures, wrapSession, language: 'en' })

    expect(screen.getByRole('alert').textContent).toContain('s exploded')
    expect(wrapSession).not.toHaveBeenCalled()
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

describe('DockView splitters', () => {
  const blocks = [registration('a'), registration('b'), registration('c')]
  const threeCells = layoutOf(row([pane(0, ['a']), pane(0, ['b']), pane(0, ['c'])], [px(200), FR, px(200)]))

  it('A2 a split of three cells draws exactly two separators named dock.splitter between them', () => {
    renderDock(threeCells, blocks)

    const separators = screen.getAllByRole('separator', { name: 'dock.splitter' })
    expect(separators).toHaveLength(2)
    for (const separator of separators) expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(screen.getAllByRole('tablist')).toHaveLength(3)
  })

  it('A3 ArrowRight on the separator of a nested split hands that split path and the new sizes to resizeSplit', () => {
    const resizeSplit = vi.fn()
    const nestedColumn: LayoutNode = {
      kind: 'split',
      axis: 'column',
      children: [pane(0, ['b']), pane(0, ['c'])],
      sizes: [FR, px(200)],
    }
    const layout = layoutOf(row([pane(0, ['a']), nestedColumn], [px(260), FR]))
    const actions = { ...makeActions(), resizeSplit }
    renderDock(layout, blocks, { actions })

    const separators = screen.getAllByRole('separator', { name: 'dock.splitter' })
    expect(separators).toHaveLength(2)
    const inner = separators.find((separator) => separator.getAttribute('aria-orientation') === 'horizontal')
    if (inner === undefined) throw new Error('no separator for the nested column split')

    inner.focus()
    fireEvent.keyDown(inner, { key: 'ArrowDown' })

    expect(resizeSplit).toHaveBeenCalledTimes(1)
    expect(resizeSplit).toHaveBeenCalledWith([1], [FR, px(192)])

    const outer = separators.find((separator) => separator.getAttribute('aria-orientation') === 'vertical')
    if (outer === undefined) throw new Error('no separator for the root split')
    fireEvent.keyDown(outer, { key: 'ArrowRight' })
    expect(resizeSplit).toHaveBeenLastCalledWith([], [px(268), FR])
  })

  it('A2 resizing through a separator changes the cell size without remounting the blocks', () => {
    const mounts = vi.fn()
    function Probe({ id }: { id: string }): ReactNode {
      useEffect(() => {
        mounts(id)
      }, [id])
      return <div data-testid={`probe-${id}`}>{id}</div>
    }

    function Harness(): ReactNode {
      const [layout, setLayout] = useState(threeCells)
      const actions = {
        ...makeActions(),
        resizeSplit: (path: readonly number[], sizes: readonly LayoutSize[]) =>
          setLayout((current) =>
            current.root?.kind === 'split' && path.length === 0
              ? { ...current, root: { ...current.root, sizes } }
              : current,
          ),
      }
      return (
        <DockView
          snapshot={{ layout, blocks }}
          actions={actions}
          renderBlock={(meta) => <Probe id={meta.id} />}
          t={t}
          language="en"
        />
      )
    }

    render(<Harness />)
    const probes = ['a', 'b', 'c'].map((id) => screen.getByTestId(`probe-${id}`))
    expect(mounts).toHaveBeenCalledTimes(3)
    expect(cellOf(probes[0] as HTMLElement).style.flexBasis).toBe('200px')

    const [first] = screen.getAllByRole('separator', { name: 'dock.splitter' })
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight' })
    fireEvent.keyDown(first as HTMLElement, { key: 'ArrowRight', shiftKey: true })

    expect(cellOf(probes[0] as HTMLElement).style.flexBasis).toBe('240px')
    ;['a', 'b', 'c'].forEach((id, index) => {
      expect(screen.getByTestId(`probe-${id}`)).toBe(probes[index])
      expect(probes[index]?.isConnected).toBe(true)
    })
    expect(mounts).toHaveBeenCalledTimes(3)
  })
})

describe('DockView block layout actions', () => {
  const BLOCK_KEYS = ['activate', 'close', 'open', 'resetToPreset', 'resize']

  it('A1 a block gets only the five layout methods, never resizeSplit, beginResize or endResize', () => {
    const actions = { ...makeActions(), resizeSplit: vi.fn(), beginResize: vi.fn(), endResize: vi.fn() }
    const { renderBlock } = renderDock(layoutOf(pane(0, ['a'], ['b'])), [registration('a'), registration('b')], {
      actions,
    })

    expect(renderBlock).toHaveBeenCalledTimes(2)
    for (const [, instance] of renderBlock.mock.calls) {
      expect(Object.keys(instance.layout).sort()).toEqual(BLOCK_KEYS)
      expect(instance.layout).not.toBe(actions)
    }
  })

  it('A1 the layout object is the same across a rerender with the same actions', () => {
    const actions = { ...makeActions(), resizeSplit: vi.fn(), beginResize: vi.fn(), endResize: vi.fn() }
    const blocks = [registration('a')]
    const renderBlock = vi.fn<DockViewProps['renderBlock']>(() => <div />)
    const dock = (layout: WebuiLayout) => (
      <DockView snapshot={{ layout, blocks }} actions={actions} renderBlock={renderBlock} t={t} language="en" />
    )
    const { rerender } = render(dock(layoutOf(pane(0, ['a']))))
    rerender(dock(layoutOf(pane(0, ['a']))))

    expect(renderBlock.mock.calls.length).toBeGreaterThanOrEqual(2)
    const first = renderBlock.mock.calls[0]?.[1].layout
    for (const [, instance] of renderBlock.mock.calls) expect(instance.layout).toBe(first)
  })

  it('A1 calling a method of the block layout forwards to the same-named method of props.actions', () => {
    const actions = { ...makeActions(), resizeSplit: vi.fn(), beginResize: vi.fn(), endResize: vi.fn() }
    const { renderBlock } = renderDock(layoutOf(pane(0, ['a'])), [registration('a')], { actions })
    const layout = renderBlock.mock.calls[0]?.[1].layout
    if (layout === undefined) throw new Error('renderBlock was not called')
    const target = { blockId: 'a', contentId: 'x' }

    layout.open(target)
    layout.close(target)
    layout.activate(target)
    layout.resize(target, { fr: 2 })
    layout.resetToPreset()

    expect(actions.open).toHaveBeenCalledWith(target)
    expect(actions.close).toHaveBeenCalledWith(target)
    expect(actions.activate).toHaveBeenCalledWith(target)
    expect(actions.resize).toHaveBeenCalledWith(target, { fr: 2 })
    expect(actions.resetToPreset).toHaveBeenCalledTimes(1)
  })

  it('A4 calling a method of the block layout returns what the same-named method of props.actions returned', () => {
    const results = {
      open: { ok: false, reason: 'unknown-block' },
      close: { ok: false, reason: 'not-closable' },
      activate: { ok: false, reason: 'no-such-tab' },
      resize: { ok: false, reason: 'not-in-split' },
      resetToPreset: { ok: true },
    } as const satisfies Record<keyof BlockLayoutActions, LayoutActionResult>
    const actions = {
      open: vi.fn(() => results.open),
      close: vi.fn(() => results.close),
      activate: vi.fn(() => results.activate),
      resize: vi.fn(() => results.resize),
      resetToPreset: vi.fn(() => results.resetToPreset),
      resizeSplit: vi.fn(),
      beginResize: vi.fn(),
      endResize: vi.fn(),
    }
    const { renderBlock } = renderDock(layoutOf(pane(0, ['a'])), [registration('a')], { actions })
    const layout = renderBlock.mock.calls[0]?.[1].layout
    if (layout === undefined) throw new Error('renderBlock was not called')
    const target = { blockId: 'a' }

    expect(layout.open(target)).toBe(results.open)
    expect(layout.close(target)).toBe(results.close)
    expect(layout.activate(target)).toBe(results.activate)
    expect(layout.resize(target, { fr: 2 })).toBe(results.resize)
    expect(layout.resetToPreset()).toBe(results.resetToPreset)
  })

  it('A1 this-bound methods of a class instance work through props.layout, each called with the instance as this and the original arguments', () => {
    class ThisActions implements BlockLayoutActions {
      calls: unknown[][] = []
      open(target: BlockTarget): LayoutActionResult {
        this.calls.push(['open', this, target])
        return { ok: true }
      }
      close(target: BlockTarget): LayoutActionResult {
        this.calls.push(['close', this, target])
        return { ok: true }
      }
      activate(target: BlockTarget): LayoutActionResult {
        this.calls.push(['activate', this, target])
        return { ok: true }
      }
      resize(target: BlockTarget, size: LayoutSize): LayoutActionResult {
        this.calls.push(['resize', this, target, size])
        return { ok: true }
      }
      resetToPreset(): LayoutActionResult {
        this.calls.push(['resetToPreset', this])
        return { ok: true }
      }
      resizeSplit(): void {}
      beginResize(): void {}
      endResize(): void {}
    }
    const actions = new ThisActions()
    const { renderBlock } = renderDock(layoutOf(pane(0, ['a'])), [registration('a')], { actions })
    const layout = renderBlock.mock.calls[0]?.[1].layout
    if (layout === undefined) throw new Error('renderBlock was not called')
    const target = { blockId: 'a', contentId: 'x' }

    layout.open(target)
    layout.close(target)
    layout.activate(target)
    layout.resize(target, { fr: 2 })
    layout.resetToPreset()

    expect(actions.calls).toEqual([
      ['open', actions, target],
      ['close', actions, target],
      ['activate', actions, target],
      ['resize', actions, target, { fr: 2 }],
      ['resetToPreset', actions],
    ])
    for (const [, self] of actions.calls) expect(self).toBe(actions)
  })

  it('A5 this-bound method shorthands of an object literal work through props.layout, each called with that object as this and the original arguments', () => {
    const actions: DockViewProps['actions'] & { calls: unknown[][] } = {
      calls: [],
      open(target: BlockTarget): LayoutActionResult {
        this.calls.push(['open', this, target])
        return { ok: true }
      },
      close(target: BlockTarget): LayoutActionResult {
        this.calls.push(['close', this, target])
        return { ok: true }
      },
      activate(target: BlockTarget): LayoutActionResult {
        this.calls.push(['activate', this, target])
        return { ok: true }
      },
      resize(target: BlockTarget, size: LayoutSize): LayoutActionResult {
        this.calls.push(['resize', this, target, size])
        return { ok: true }
      },
      resetToPreset(): LayoutActionResult {
        this.calls.push(['resetToPreset', this])
        return { ok: true }
      },
      resizeSplit(): void {},
      beginResize(): void {},
      endResize(): void {},
    }
    const { renderBlock } = renderDock(layoutOf(pane(0, ['a'])), [registration('a')], { actions })
    const layout = renderBlock.mock.calls[0]?.[1].layout
    if (layout === undefined) throw new Error('renderBlock was not called')
    const target = { blockId: 'a', contentId: 'x' }

    layout.open(target)
    layout.close(target)
    layout.activate(target)
    layout.resize(target, { fr: 2 })
    layout.resetToPreset()

    expect(actions.calls).toEqual([
      ['open', actions, target],
      ['close', actions, target],
      ['activate', actions, target],
      ['resize', actions, target, { fr: 2 }],
      ['resetToPreset', actions],
    ])
    for (const [, self] of actions.calls) expect(self).toBe(actions)
  })

  it('A3 pointerdown on a separator calls actions.beginResize once, pointerup calls endResize once, the keyboard neither', () => {
    const beginResize = vi.fn()
    const endResize = vi.fn()
    const actions = { ...makeActions(), resizeSplit: vi.fn(), beginResize, endResize }
    const layout = layoutOf(row([pane(0, ['a']), pane(0, ['b'])], [px(200), FR]))
    renderDock(layout, [registration('a'), registration('b')], { actions })
    const separator = screen.getByRole('separator', { name: 'dock.splitter' })
    Object.assign(separator, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(beginResize).not.toHaveBeenCalled()
    expect(endResize).not.toHaveBeenCalled()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    expect(beginResize).toHaveBeenCalledTimes(1)
    expect(endResize).not.toHaveBeenCalled()
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 110 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 110 })
    expect(beginResize).toHaveBeenCalledTimes(1)
    expect(endResize).toHaveBeenCalledTimes(1)
  })

  it('A5 a separator that disappears mid-drag ends the gesture: actions.endResize is called once', () => {
    const actions = { ...makeActions(), resizeSplit: vi.fn(), beginResize: vi.fn(), endResize: vi.fn() }
    const blocks = [registration('a'), registration('b')]
    const renderBlock = vi.fn<DockViewProps['renderBlock']>(() => <div />)
    const dock = (layout: WebuiLayout) => (
      <DockView snapshot={{ layout, blocks }} actions={actions} renderBlock={renderBlock} t={t} language="en" />
    )
    const { rerender } = render(dock(layoutOf(row([pane(0, ['a']), pane(0, ['b'])], [px(200), FR]))))
    const separator = screen.getByRole('separator', { name: 'dock.splitter' })
    Object.assign(separator, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    expect(actions.endResize).not.toHaveBeenCalled()
    rerender(dock(layoutOf(pane(0, ['a']))))

    expect(screen.queryByRole('separator')).toBeNull()
    expect(actions.beginResize).toHaveBeenCalledTimes(1)
    expect(actions.endResize).toHaveBeenCalledTimes(1)
  })
})

describe('DockView close button names', () => {
  /** Copy from the real dictionaries, interpolating `{name}` placeholders like the host does. */
  const translateIn = (dictionary: Record<string, string>) =>
    ((key: string, params: Record<string, unknown> = {}) =>
      (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )) as unknown as WebuiTranslate
  const hello = registration('hello', { title: { en: 'Hello', zh: '你好' } })
  const bye = registration('bye', { title: { en: 'Bye', zh: '再见' } })

  it('A1 the close button is named after the tab title in each language', () => {
    renderDock(layoutOf(pane(0, ['hello'])), [hello], { language: 'en', translate: translateIn(en) })
    expect(screen.getByRole('button', { name: 'Close tab: Hello' })).not.toBeNull()
    cleanup()

    renderDock(layoutOf(pane(0, ['hello'])), [hello], { language: 'zh-CN', translate: translateIn(zh) })
    expect(screen.getByRole('button', { name: '关闭标签：你好' })).not.toBeNull()
  })

  it('A2 two closable tabs in one pane have different close button names, and each closes only its own tab', () => {
    const { actions } = renderDock(layoutOf(pane(0, ['hello'], ['bye'])), [hello, bye], {
      language: 'en',
      translate: translateIn(en),
    })

    const names = screen
      .getAllByRole('button', { name: /^Close tab/ })
      .map((button) => button.getAttribute('aria-label'))
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Close tab: Bye' }))
    expect(actions.close).toHaveBeenCalledTimes(1)
    expect(actions.close).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'bye' }))
  })

  describe('tab titles', () => {
    const note = registration('n', { multiInstance: true, title: { en: 'Note', zh: '笔记' } })
    const one = { blockId: 'n', contentId: 'one' }
    const two = { blockId: 'n', contentId: 'two' }
    const titlesOf = (...entries: [typeof one, LocalizedText][]) =>
      new Map(entries.map(([ref, title]) => [tabKey(ref), title] as const))

    it('A4 two tabs of one multi-instance block show their own titles, and each close button carries its own', () => {
      const titles = titlesOf([one, { en: 'a.txt' }], [two, { en: 'b.txt' }])
      renderDock(layoutOf(pane(0, ['n', 'one'], ['n', 'two'])), [note], {
        language: 'en',
        translate: translateIn(en),
        titles,
      })

      expect(screen.getByRole('tab', { name: 'a.txt' })).not.toBeNull()
      expect(screen.getByRole('tab', { name: 'b.txt' })).not.toBeNull()
      expect(screen.queryByRole('tab', { name: 'Note' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Close tab: a.txt' })).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Close tab: b.txt' })).not.toBeNull()
    })

    it('A4 a tab title follows the language, any language tag included', () => {
      const titles = titlesOf([one, { en: 'a.txt', zh: '甲.txt', fr: 'fichier-a' }])
      const layout = layoutOf(pane(0, ['n', 'one']))
      renderDock(layout, [note], { language: 'zh-CN', translate: translateIn(zh), titles })
      expect(screen.getByRole('tab', { name: '甲.txt' })).not.toBeNull()
      expect(screen.getByRole('button', { name: '关闭标签：甲.txt' })).not.toBeNull()
      cleanup()

      renderDock(layout, [note], { language: 'fr-FR', translate: translateIn(en), titles })
      expect(screen.getByRole('tab', { name: 'fichier-a' })).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Close tab: fichier-a' })).not.toBeNull()
    })

    it('A4 a tab without a tab title shows the block title', () => {
      renderDock(layoutOf(pane(0, ['n', 'one'], ['n', 'two'])), [note], {
        language: 'en',
        translate: translateIn(en),
        titles: titlesOf([one, { en: 'a.txt' }]),
      })

      expect(screen.getByRole('tab', { name: 'a.txt' })).not.toBeNull()
      expect(screen.getByRole('tab', { name: 'Note' })).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Close tab: Note' })).not.toBeNull()
    })

    it('A4 the error card of a failed tab is titled with the tab title', () => {
      const failures = new Map<string, BlockFailure>([['n', { blockId: 'n', error: new Error('n exploded') }]])
      renderDock(layoutOf(pane(0, ['n', 'one'])), [note], {
        language: 'en',
        failures,
        titles: titlesOf([one, { en: 'a.txt' }]),
      })

      const card = screen.getByRole('alert')
      expect(card.textContent).toContain('n exploded')
      expect(card.textContent).toContain('a.txt')
      expect(card.textContent).not.toContain('Note')
    })
  })
})

describe('DockView tab handle', () => {
  const blocks = [registration('n', { multiInstance: true })]
  const dock = (layout: WebuiLayout, actions: DockViewProps['actions'], renderBlock: DockViewProps['renderBlock']) => (
    <DockView snapshot={{ layout, blocks }} actions={actions} renderBlock={renderBlock} t={t} language="en" />
  )
  const handleOf = (renderBlock: ReturnType<typeof vi.fn<DockViewProps['renderBlock']>>, contentId: string) => {
    const call = renderBlock.mock.calls.find(([, instance]) => instance.contentId === contentId)
    if (call === undefined) throw new Error(`no render for ${contentId}`)
    return call[1].tab
  }

  it('A5 tab.setTitle forwards to actions.setTabTitle with the ref of that tab', () => {
    const setTabTitle = vi.fn()
    const actions = { ...makeActions(), setTabTitle }
    const renderBlock = vi.fn<DockViewProps['renderBlock']>(() => <div />)
    render(dock(layoutOf(pane(0, ['n', 'one'], ['n', 'two'])), actions, renderBlock))

    handleOf(renderBlock, 'one').setTitle({ en: 'a.txt' })
    expect(setTabTitle).toHaveBeenLastCalledWith({ blockId: 'n', contentId: 'one' }, { en: 'a.txt' })
    handleOf(renderBlock, 'two').setTitle(null)
    expect(setTabTitle).toHaveBeenLastCalledWith({ blockId: 'n', contentId: 'two' }, null)
    expect(setTabTitle).toHaveBeenCalledTimes(2)
  })

  it('A5 tab.setCloseGuard forwards to actions.setCloseGuard with the ref of that tab', () => {
    const setCloseGuard = vi.fn()
    const actions = { ...makeActions(), setCloseGuard }
    const renderBlock = vi.fn<DockViewProps['renderBlock']>(() => <div />)
    render(dock(layoutOf(pane(0, ['n', 'one'], ['n', 'two'])), actions, renderBlock))
    const guard = () => false

    handleOf(renderBlock, 'one').setCloseGuard(guard)
    expect(setCloseGuard).toHaveBeenLastCalledWith({ blockId: 'n', contentId: 'one' }, guard)
    handleOf(renderBlock, 'two').setCloseGuard(null)
    expect(setCloseGuard).toHaveBeenLastCalledWith({ blockId: 'n', contentId: 'two' }, null)
    expect(setCloseGuard).toHaveBeenCalledTimes(2)
  })

  it('A5 the × button of a tab calls actions.close for its ref, and a vetoed close leaves the tab rendered', () => {
    const close = vi.fn<BlockLayoutActions['close']>(() => ({ ok: false, reason: 'vetoed' }))
    const actions = { ...makeActions(), close }
    const renderBlock = vi.fn<DockViewProps['renderBlock']>((_meta, instance) => (
      <div data-testid={`tab-${instance.contentId}`} />
    ))
    render(dock(layoutOf(pane(0, ['n', 'one'], ['n', 'two'])), actions, renderBlock))

    fireEvent.click(screen.getAllByRole('button', { name: 'dock.tab.close' })[1] as HTMLElement)

    expect(close).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'n', contentId: 'two' }))
    expect(screen.getAllByRole('button', { name: 'dock.tab.close' })).toHaveLength(2)
    expect(screen.getByTestId('tab-one')).not.toBeNull()
    expect(screen.getByTestId('tab-two')).not.toBeNull()
  })

  it('A5 the same ref gets the same tab object across rerenders, another ref another one', () => {
    const actions = { ...makeActions(), setTabTitle: vi.fn() }
    const renderBlock = vi.fn<DockViewProps['renderBlock']>(() => <div />)
    const { rerender } = render(dock(layoutOf(pane(0, ['n', 'one'], ['n', 'two'])), actions, renderBlock))
    const firstOne = handleOf(renderBlock, 'one')
    const firstTwo = handleOf(renderBlock, 'two')
    renderBlock.mockClear()

    rerender(dock(layoutOf(pane(1, ['n', 'one'], ['n', 'two'])), actions, renderBlock))

    expect(renderBlock).toHaveBeenCalled()
    expect(handleOf(renderBlock, 'one')).toBe(firstOne)
    expect(handleOf(renderBlock, 'two')).toBe(firstTwo)
    expect(firstOne).not.toBe(firstTwo)
  })
})
