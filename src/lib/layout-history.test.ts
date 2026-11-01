import type { WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it } from 'vitest'
import { EMPTY_LAYOUT_HISTORY, LAYOUT_HISTORY_LIMIT, recordLayout, stepBack, stepForward } from './layout-history.ts'
import type { LayoutHistory } from './layout-history.ts'
import { deepFreeze } from '../test/deep-freeze.ts'

const layout = (blockId: string): WebuiLayout => ({
  version: 1,
  root: { kind: 'pane', tabs: [{ blockId, contentId: '' }], active: 0 },
  activePane: [],
})
const [A, B, C, D] = ['a', 'b', 'c', 'd'].map(layout) as [WebuiLayout, WebuiLayout, WebuiLayout, WebuiLayout]

describe('layout history', () => {
  it('A1 recordLayout appends before to past and clears future, leaving the input alone', () => {
    const history = deepFreeze<LayoutHistory>({ past: [A], future: [C] })

    const next = recordLayout(history, B)

    expect(next.past).toEqual([A, B])
    expect(next.future).toEqual([])
    expect(history.past).toEqual([A])
    expect(history.future).toEqual([C])
    expect(recordLayout(EMPTY_LAYOUT_HISTORY, A)).toEqual({ past: [A], future: [] })
    expect(EMPTY_LAYOUT_HISTORY).toEqual({ past: [], future: [] })
  })

  it('A2 stepBack and stepForward move one snapshot across and return undefined when there is none', () => {
    const history = deepFreeze<LayoutHistory>({ past: [A, B], future: [D, C] })

    const back = stepBack(history, D)
    expect(back?.layout).toBe(B)
    expect(back?.history).toEqual({ past: [A], future: [D, C, D] })

    const forward = stepForward(history, D)
    expect(forward?.layout).toBe(C)
    expect(forward?.history).toEqual({ past: [A, B, D], future: [D] })

    expect(history.past).toEqual([A, B])
    expect(history.future).toEqual([D, C])
    expect(stepBack({ past: [], future: [C] }, D)).toBeUndefined()
    expect(stepForward({ past: [A], future: [] }, D)).toBeUndefined()
    expect(stepBack(EMPTY_LAYOUT_HISTORY, A)).toBeUndefined()
    expect(stepForward(EMPTY_LAYOUT_HISTORY, A)).toBeUndefined()
  })

  it('A3 a new record after stepBack drops the undone step', () => {
    let history = recordLayout(recordLayout(EMPTY_LAYOUT_HISTORY, A), B)
    const back = stepBack(history, C)
    expect(back?.layout).toBe(B)
    history = recordLayout(back!.history, B)
    expect(history.future).toEqual([])

    expect(stepForward(history, D)).toBeUndefined()
  })

  it('A4 the history keeps at most 100 snapshots, dropping the oldest', () => {
    const layouts = Array.from({ length: LAYOUT_HISTORY_LIMIT + 1 }, (_, index) => layout(`l${index}`))
    let history = EMPTY_LAYOUT_HISTORY
    for (const before of layouts) history = recordLayout(history, before)

    expect(LAYOUT_HISTORY_LIMIT).toBe(100)
    expect(history.past).toHaveLength(100)
    expect(history.past[0]).toBe(layouts[1])
    expect(history.past[99]).toBe(layouts[100])

    let current = layout('current')
    const undone: WebuiLayout[] = []
    for (let step = 0; step < 100; step++) {
      const back = stepBack(history, current)
      expect(back).toBeDefined()
      undone.push(back!.layout)
      current = back!.layout
      history = back!.history
    }
    expect(undone[0]).toBe(layouts[100])
    expect(undone[99]).toBe(layouts[1])
    expect(stepBack(history, current)).toBeUndefined()
    expect(history.past.length + history.future.length).toBe(100)

    for (let step = 0; step < 100; step++) {
      const forward = stepForward(history, current)
      expect(forward).toBeDefined()
      current = forward!.layout
      history = forward!.history
    }
    expect(history.past).toHaveLength(100)
    expect(history.future).toHaveLength(0)
    expect(stepForward(history, current)).toBeUndefined()
  })
})
