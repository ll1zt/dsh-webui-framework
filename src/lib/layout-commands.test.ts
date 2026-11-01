import type { BlockRef, LayoutNode, LayoutPane, LayoutSize, WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it } from 'vitest'
import { LAYOUT_COMMAND_IDS, panePaths, planLayoutCommand, type LayoutCommandId } from './layout-commands.ts'
import { deepFreeze } from '../test/deep-freeze.ts'

const FR: LayoutSize = { fr: 1 }

const tab = (blockId: string): BlockRef => ({ blockId, contentId: '' })
const pane = (active: number, ...ids: string[]): LayoutPane => ({ kind: 'pane', tabs: ids.map(tab), active })
const row = (...children: LayoutNode[]): LayoutNode => ({
  kind: 'split',
  axis: 'row',
  children,
  sizes: children.map(() => FR),
})
const column = (...children: LayoutNode[]): LayoutNode => ({
  kind: 'split',
  axis: 'column',
  children,
  sizes: children.map(() => FR),
})
const layoutOf = (root: LayoutNode | null, activePane: number[] = []): WebuiLayout => ({
  version: 1,
  root,
  activePane,
})

/** Panes in order: [0] a(active 0 of a,b,c), [1,0] d, [1,1] e(active 1 of e,f). */
const THREE = (activePane: number[] = [0]): WebuiLayout =>
  layoutOf(row(pane(0, 'a', 'b', 'c'), column(pane(0, 'd'), pane(1, 'e', 'f'))), activePane)

describe('layout command ids and pane paths', () => {
  it('A1 lists the seven command ids in order', () => {
    expect(LAYOUT_COMMAND_IDS).toEqual([
      'webui.tab.close',
      'webui.tab.next',
      'webui.tab.previous',
      'webui.pane.next',
      'webui.pane.previous',
      'webui.layout.undo',
      'webui.layout.redo',
    ])
  })

  it('A1 panePaths is empty for no root and [[]] for a root pane', () => {
    expect(panePaths(null)).toEqual([])
    expect(panePaths(pane(0, 'a'))).toEqual([[]])
  })

  it('A1 panePaths walks nested splits depth first, front to back', () => {
    expect(panePaths(row(pane(0, 'a'), column(pane(0, 'b'), pane(0, 'c'))))).toEqual([[0], [1, 0], [1, 1]])
  })
})

describe('planLayoutCommand current pane', () => {
  it('A2 uses a focused pane path when it names a pane', () => {
    expect(planLayoutCommand(THREE([0]), 'webui.tab.close', [1, 1])).toEqual({ kind: 'close', target: tab('f') })
    expect(planLayoutCommand(THREE([0]), 'webui.tab.close', [1, 0])).toEqual({ kind: 'close', target: tab('d') })
  })

  it('A2 falls back to activePane when focus is undefined', () => {
    expect(planLayoutCommand(THREE([1, 1]), 'webui.tab.close', undefined)).toEqual({ kind: 'close', target: tab('f') })
  })

  it('A2 falls back to activePane when the focused path points at a split or is out of range', () => {
    expect(planLayoutCommand(THREE([1, 1]), 'webui.tab.close', [1])).toEqual({ kind: 'close', target: tab('f') })
    expect(planLayoutCommand(THREE([1, 1]), 'webui.tab.close', [5])).toEqual({ kind: 'close', target: tab('f') })
    expect(planLayoutCommand(THREE([1, 1]), 'webui.tab.close', [0, 0])).toEqual({ kind: 'close', target: tab('f') })
  })

  it('A2 returns undefined for all seven commands when the layout is empty', () => {
    for (const command of LAYOUT_COMMAND_IDS) {
      expect(planLayoutCommand(layoutOf(null), command, undefined)).toBeUndefined()
      expect(planLayoutCommand(layoutOf(null), command, [0])).toBeUndefined()
    }
  })
})

describe('planLayoutCommand tabs', () => {
  it('A3 tab.close targets the active tab of the current pane', () => {
    expect(planLayoutCommand(THREE(), 'webui.tab.close', [0])).toEqual({ kind: 'close', target: tab('a') })
    expect(planLayoutCommand(THREE(), 'webui.tab.close', [1, 1])).toEqual({ kind: 'close', target: tab('f') })
  })

  it('A3 tab.next and tab.previous step inside the current pane', () => {
    const layout = layoutOf(pane(1, 'a', 'b', 'c'))
    expect(planLayoutCommand(layout, 'webui.tab.next', [])).toEqual({ kind: 'activate', target: tab('c'), pane: [] })
    expect(planLayoutCommand(layout, 'webui.tab.previous', [])).toEqual({ kind: 'activate', target: tab('a'), pane: [] })
  })

  it('A3 tab.next wraps from the last tab to the first, tab.previous from the first to the last', () => {
    expect(planLayoutCommand(layoutOf(pane(2, 'a', 'b', 'c')), 'webui.tab.next', [])).toEqual({
      kind: 'activate',
      target: tab('a'),
      pane: [],
    })
    expect(planLayoutCommand(layoutOf(pane(0, 'a', 'b', 'c')), 'webui.tab.previous', [])).toEqual({
      kind: 'activate',
      target: tab('c'),
      pane: [],
    })
  })

  it('A3 reports the current pane path, not the active pane, on tab switches', () => {
    expect(planLayoutCommand(THREE([0]), 'webui.tab.next', [1, 1])).toEqual({
      kind: 'activate',
      target: tab('e'),
      pane: [1, 1],
    })
  })

  it('A3 tab.next and tab.previous are undefined for a pane with one tab', () => {
    expect(planLayoutCommand(THREE([1, 0]), 'webui.tab.next', undefined)).toBeUndefined()
    expect(planLayoutCommand(THREE([1, 0]), 'webui.tab.previous', undefined)).toBeUndefined()
  })
})

describe('planLayoutCommand panes and history', () => {
  it('A4 pane.next and pane.previous move in panePaths order and target the active tab there', () => {
    expect(planLayoutCommand(THREE(), 'webui.pane.next', [0])).toEqual({ kind: 'activate', target: tab('d'), pane: [1, 0] })
    expect(planLayoutCommand(THREE(), 'webui.pane.next', [1, 0])).toEqual({
      kind: 'activate',
      target: tab('f'),
      pane: [1, 1],
    })
    expect(planLayoutCommand(THREE(), 'webui.pane.previous', [1, 1])).toEqual({
      kind: 'activate',
      target: tab('d'),
      pane: [1, 0],
    })
  })

  it('A4 pane.next wraps from the last pane to the first, pane.previous from the first to the last', () => {
    expect(planLayoutCommand(THREE(), 'webui.pane.next', [1, 1])).toEqual({ kind: 'activate', target: tab('a'), pane: [0] })
    expect(planLayoutCommand(THREE(), 'webui.pane.previous', [0])).toEqual({
      kind: 'activate',
      target: tab('f'),
      pane: [1, 1],
    })
  })

  it('A4 pane.next and pane.previous are undefined with a single pane', () => {
    const layout = layoutOf(pane(0, 'a', 'b'))
    expect(planLayoutCommand(layout, 'webui.pane.next', [])).toBeUndefined()
    expect(planLayoutCommand(layout, 'webui.pane.previous', [])).toBeUndefined()
  })

  it('A4 layout.undo and layout.redo are plain steps', () => {
    expect(planLayoutCommand(THREE(), 'webui.layout.undo', undefined)).toEqual({ kind: 'undo' })
    expect(planLayoutCommand(THREE(), 'webui.layout.redo', undefined)).toEqual({ kind: 'redo' })
  })

  it('A4 does not modify a deep-frozen layout, whatever the command', () => {
    const layout = deepFreeze(THREE([1, 1]))
    const snapshot = structuredClone(layout)
    const commands: readonly LayoutCommandId[] = LAYOUT_COMMAND_IDS

    for (const command of commands) planLayoutCommand(layout, command, [1, 0])
    panePaths(layout.root)

    expect(layout).toEqual(snapshot)
  })
})
