import type { LayoutNode, LayoutSize, LayoutSplit } from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it } from 'vitest'
import { dragResize } from './split-resize.ts'

const FR: LayoutSize = { fr: 1 }
const px = (value: number, min = 100, max = 400): LayoutSize => ({ px: value, min, max })

const pane = (blockId: string): LayoutNode => ({ kind: 'pane', tabs: [{ blockId, contentId: '' }], active: 0 })
const row = (sizes: LayoutSize[]): LayoutSplit => ({
  kind: 'split',
  axis: 'row',
  children: sizes.map((_, index) => pane(`b${index}`)),
  sizes,
})

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function frOf(size: LayoutSize | undefined): number {
  if (size === undefined || !('fr' in size)) throw new Error('not an fr size')
  return size.fr
}

describe('dragResize', () => {
  it('A1 a px left side grows and shrinks by the displacement and stops at max and min', () => {
    const split = deepFreeze(row([px(200), FR]))

    expect(dragResize(split, 0, 50, 1000).sizes).toEqual([px(250), FR])
    expect(dragResize(split, 0, -30, 1000).sizes).toEqual([px(170), FR])
    expect(dragResize(split, 0, 500, 1000).sizes).toEqual([px(400), FR])
    expect(dragResize(split, 0, -500, 1000).sizes).toEqual([px(100), FR])
  })

  it('A1 a px right side moves the opposite way and stops at its limits', () => {
    const split = deepFreeze(row([FR, px(200)]))

    expect(dragResize(split, 0, 50, 1000).sizes).toEqual([FR, px(150)])
    expect(dragResize(split, 0, -50, 1000).sizes).toEqual([FR, px(250)])
    expect(dragResize(split, 0, 500, 1000).sizes).toEqual([FR, px(100)])
    expect(dragResize(split, 0, -500, 1000).sizes).toEqual([FR, px(400)])
  })

  it('A1 with a px and an fr side only the px side changes, and the other children stay as they are', () => {
    const split = deepFreeze(row([px(150), px(200), FR, { fr: 3 }]))

    const next = dragResize(split, 1, 40, 1000)

    expect(next.sizes).toEqual([px(150), px(240), FR, { fr: 3 }])
    expect(next.axis).toBe('row')
    expect(next.children).toEqual(split.children)
  })

  it('A1 with px on both sides the left grows as the right shrinks, and both stop at the first limit hit', () => {
    const split = deepFreeze(row([px(200), px(200)]))

    expect(dragResize(split, 0, 60, 1000).sizes).toEqual([px(260), px(140)])
    expect(dragResize(split, 0, -60, 1000).sizes).toEqual([px(140), px(260)])
    // The right side reaches its min (100) after 100px, while the left could still grow by 200.
    expect(dragResize(split, 0, 300, 1000).sizes).toEqual([px(300), px(100)])
    expect(dragResize(split, 0, -300, 1000).sizes).toEqual([px(100), px(300)])
  })

  it('A1 with fr on both sides the pair keeps its sum and is shared out by pixels', () => {
    const split = deepFreeze(row([FR, FR]))

    // 1000px over 2fr is 500px per fr.
    const next = dragResize(split, 0, 250, 1000)
    expect(frOf(next.sizes[0])).toBeCloseTo(1.5)
    expect(frOf(next.sizes[1])).toBeCloseTo(0.5)

    const back = dragResize(split, 0, -250, 1000)
    expect(frOf(back.sizes[0])).toBeCloseTo(0.5)
    expect(frOf(back.sizes[1])).toBeCloseTo(1.5)
  })

  it('A1 with fr on both sides neither side drops below 5% of the pair sum', () => {
    const split = deepFreeze(row([{ fr: 2 }, { fr: 2 }]))

    const high = dragResize(split, 0, 100000, 1000)
    expect(frOf(high.sizes[0])).toBeCloseTo(3.8)
    expect(frOf(high.sizes[1])).toBeCloseTo(0.2)

    const low = dragResize(split, 0, -100000, 1000)
    expect(frOf(low.sizes[0])).toBeCloseTo(0.2)
    expect(frOf(low.sizes[1])).toBeCloseTo(3.8)
  })

  it('A1 the pixels per fr leave out the px sizes, and the other children stay as they are', () => {
    const split = deepFreeze(row([px(200), FR, { fr: 3 }]))

    // (1000 - 200) / 4fr = 200px per fr, so 200px moves exactly one fr.
    const next = dragResize(split, 1, 200, 1000)

    expect(next.sizes[0]).toEqual(px(200))
    expect(frOf(next.sizes[1])).toBeCloseTo(2)
    expect(frOf(next.sizes[2])).toBeCloseTo(2)
  })

  it('A1 with fr on both sides and no container length the split is returned unchanged', () => {
    const split = deepFreeze(row([FR, FR]))

    expect(dragResize(split, 0, 40, 0)).toEqual(split)
  })

  it('A1 an index outside the children returns the same split object', () => {
    const split = deepFreeze(row([px(200), FR, FR]))

    expect(dragResize(split, -1, 20, 1000)).toBe(split)
    expect(dragResize(split, 2, 20, 1000)).toBe(split)
    expect(dragResize(split, 3, 20, 1000)).toBe(split)
    expect(dragResize(split, 0.5, 20, 1000)).toBe(split)
  })
})
