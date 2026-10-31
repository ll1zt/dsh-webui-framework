// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { LayoutNode, LayoutSize, LayoutSplit } from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Splitter } from './Splitter.tsx'

const FR: LayoutSize = { fr: 1 }
const px = (value: number, min = 100, max = 400): LayoutSize => ({ px: value, min, max })

const pane = (blockId: string): LayoutNode => ({ kind: 'pane', tabs: [{ blockId, contentId: '' }], active: 0 })
const splitOf = (axis: 'row' | 'column', sizes: LayoutSize[]): LayoutSplit => ({
  kind: 'split',
  axis,
  children: sizes.map((_, index) => pane(`b${index}`)),
  sizes,
})

function setup(split: LayoutSplit, index = 0) {
  const onResize = vi.fn<(next: LayoutSplit) => void>()
  const onResizeStart = vi.fn<() => void>()
  const onResizeEnd = vi.fn<() => void>()
  const containerPx = vi.fn(() => 1000)
  const { unmount } = render(
    <Splitter
      split={split}
      index={index}
      containerPx={containerPx}
      onResize={onResize}
      label="Resize panes"
      onResizeStart={onResizeStart}
      onResizeEnd={onResizeEnd}
    />,
  )
  const separator = screen.getByRole('separator', { name: 'Resize panes' })
  return { separator, onResize, containerPx, onResizeStart, onResizeEnd, unmount }
}

/** The sizes handed to the latest onResize call. */
function lastSizes(onResize: ReturnType<typeof setup>['onResize']): readonly LayoutSize[] {
  const next = onResize.mock.lastCall?.[0]
  if (next === undefined) throw new Error('onResize was not called')
  return next.sizes
}

/** happy-dom has no pointer capture; the splitter must call it, so the tests give it something to call. */
function stubCapture(element: HTMLElement) {
  const setPointerCapture = vi.fn()
  const releasePointerCapture = vi.fn()
  Object.assign(element, { setPointerCapture, releasePointerCapture })
  return { setPointerCapture, releasePointerCapture }
}

afterEach(() => {
  cleanup()
})

describe('Splitter', () => {
  it('A2 is a labelled separator that Tab can reach, vertical in a row split and horizontal in a column split', () => {
    const { separator } = setup(splitOf('row', [px(260), FR]))

    expect(separator.getAttribute('aria-orientation')).toBe('vertical')
    expect(separator.tabIndex).toBe(0)
    separator.focus()
    expect(document.activeElement).toBe(separator)
    cleanup()

    const column = setup(splitOf('column', [px(260), FR]))
    expect(column.separator.getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('A2 a px left side reports its px, min and max as the value attributes', () => {
    const { separator } = setup(splitOf('row', [px(260, 180, 480), FR]))

    expect(separator.getAttribute('aria-valuenow')).toBe('260')
    expect(separator.getAttribute('aria-valuemin')).toBe('180')
    expect(separator.getAttribute('aria-valuemax')).toBe('480')
  })

  it('A2 with an fr left side and a px right side the value attributes are the right side', () => {
    const { separator } = setup(splitOf('row', [FR, px(220, 150, 500)]))

    expect(separator.getAttribute('aria-valuenow')).toBe('220')
    expect(separator.getAttribute('aria-valuemin')).toBe('150')
    expect(separator.getAttribute('aria-valuemax')).toBe('500')
  })

  it('A2 with fr on both sides there are no value attributes', () => {
    const { separator } = setup(splitOf('row', [FR, FR]))

    expect(separator.hasAttribute('aria-valuenow')).toBe(false)
    expect(separator.hasAttribute('aria-valuemin')).toBe(false)
    expect(separator.hasAttribute('aria-valuemax')).toBe(false)
  })

  it('A3 ArrowRight grows the left px side by 8, ArrowLeft shrinks it by 8, and the key is consumed', () => {
    const { separator, onResize, containerPx } = setup(splitOf('row', [px(200), FR]))
    separator.focus()

    const notPrevented = fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(notPrevented).toBe(false)
    expect(lastSizes(onResize)).toEqual([px(208), FR])
    expect(containerPx).toHaveBeenCalled()

    fireEvent.keyDown(separator, { key: 'ArrowLeft' })
    expect(lastSizes(onResize)).toEqual([px(192), FR])
    expect(onResize).toHaveBeenCalledTimes(2)
  })

  it('A3 Shift+ArrowRight and Shift+ArrowLeft move by 32', () => {
    const { separator, onResize } = setup(splitOf('row', [px(200), FR]))
    separator.focus()

    fireEvent.keyDown(separator, { key: 'ArrowRight', shiftKey: true })
    expect(lastSizes(onResize)).toEqual([px(232), FR])

    fireEvent.keyDown(separator, { key: 'ArrowLeft', shiftKey: true })
    expect(lastSizes(onResize)).toEqual([px(168), FR])
  })

  it('A3 Home goes to the min and End to the max of the left px side', () => {
    const { separator, onResize } = setup(splitOf('row', [px(200, 120, 360), FR]))
    separator.focus()

    fireEvent.keyDown(separator, { key: 'Home' })
    expect(lastSizes(onResize)).toEqual([px(120, 120, 360), FR])

    fireEvent.keyDown(separator, { key: 'End' })
    expect(lastSizes(onResize)).toEqual([px(360, 120, 360), FR])
  })

  it('A3 with a px right side ArrowRight shrinks it, and Home and End still reach its min and max', () => {
    const { separator, onResize } = setup(splitOf('row', [FR, px(200, 120, 360)]))
    separator.focus()

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(lastSizes(onResize)).toEqual([FR, px(192, 120, 360)])

    fireEvent.keyDown(separator, { key: 'Home' })
    expect(lastSizes(onResize)).toEqual([FR, px(120, 120, 360)])

    fireEvent.keyDown(separator, { key: 'End' })
    expect(lastSizes(onResize)).toEqual([FR, px(360, 120, 360)])
  })

  it('A3 in a column split ArrowDown grows the upper px side and ArrowUp shrinks it', () => {
    const { separator, onResize } = setup(splitOf('column', [px(200), FR]))
    separator.focus()

    fireEvent.keyDown(separator, { key: 'ArrowDown' })
    expect(lastSizes(onResize)).toEqual([px(208), FR])

    fireEvent.keyDown(separator, { key: 'ArrowUp', shiftKey: true })
    expect(lastSizes(onResize)).toEqual([px(168), FR])
  })

  it('A3 other keys do nothing and are not consumed', () => {
    const { separator, onResize } = setup(splitOf('row', [px(200), FR]))
    separator.focus()

    expect(fireEvent.keyDown(separator, { key: 'a' })).toBe(true)
    expect(fireEvent.keyDown(separator, { key: 'Enter' })).toBe(true)
    expect(onResize).not.toHaveBeenCalled()
  })

  it('A4 pointerdown captures the pointer', () => {
    const { separator } = setup(splitOf('row', [px(200), FR]))
    const { setPointerCapture } = stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 7, clientX: 100 })

    expect(setPointerCapture).toHaveBeenCalledTimes(1)
    expect(setPointerCapture).toHaveBeenCalledWith(7)
  })

  it('A4 pointermove resizes from the start split by the displacement, and moves do not accumulate', () => {
    const { separator, onResize } = setup(splitOf('row', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 120 })
    expect(lastSizes(onResize)).toEqual([px(220), FR])

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 130 })
    expect(lastSizes(onResize)).toEqual([px(230), FR])

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 90 })
    expect(lastSizes(onResize)).toEqual([px(190), FR])
  })

  it('A4 in a column split the displacement comes from clientY', () => {
    const { separator, onResize } = setup(splitOf('column', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 500, clientY: 50 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 900, clientY: 75 })

    expect(lastSizes(onResize)).toEqual([px(225), FR])
  })

  it('A4 a move without pointerdown does nothing, and after pointerup moves call nothing more', () => {
    const { separator, onResize } = setup(splitOf('row', [px(200), FR]))
    const { releasePointerCapture } = stubCapture(separator)

    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 50 })
    expect(onResize).not.toHaveBeenCalled()

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 110 })
    expect(onResize).toHaveBeenCalledTimes(1)

    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 110 })
    expect(releasePointerCapture).toHaveBeenCalledWith(1)
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 150 })
    expect(onResize).toHaveBeenCalledTimes(1)
  })

  it('A4 pointercancel ends the drag as well', () => {
    const { separator, onResize } = setup(splitOf('row', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerCancel(separator, { pointerId: 1 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 150 })

    expect(onResize).not.toHaveBeenCalled()
  })

  it('A3 pointerdown calls onResizeStart, and pointerup calls onResizeEnd once, after the moves', () => {
    const { separator, onResize, onResizeStart, onResizeEnd } = setup(splitOf('row', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    expect(onResizeStart).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).not.toHaveBeenCalled()
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 110 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 120 })
    expect(onResize).toHaveBeenCalledTimes(2)
    expect(onResizeEnd).not.toHaveBeenCalled()

    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 120 })
    expect(onResizeStart).toHaveBeenCalledTimes(1)
    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it('A3 pointercancel calls onResizeEnd once', () => {
    const { separator, onResizeEnd } = setup(splitOf('row', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerCancel(separator, { pointerId: 1 })

    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it('A3 keyboard resizing calls neither onResizeStart nor onResizeEnd', () => {
    const { separator, onResize, onResizeStart, onResizeEnd } = setup(splitOf('row', [px(200), FR]))
    separator.focus()

    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    fireEvent.keyDown(separator, { key: 'End' })

    expect(onResize).toHaveBeenCalledTimes(2)
    expect(onResizeStart).not.toHaveBeenCalled()
    expect(onResizeEnd).not.toHaveBeenCalled()
  })

  it('A3 a pointerup or pointercancel without a pointerdown calls no onResizeEnd', () => {
    const { separator, onResizeStart, onResizeEnd } = setup(splitOf('row', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerUp(separator, { pointerId: 1 })
    fireEvent.pointerCancel(separator, { pointerId: 1 })

    expect(onResizeStart).not.toHaveBeenCalled()
    expect(onResizeEnd).not.toHaveBeenCalled()
  })

  it('A4 unmounting between pointerdown and pointerup calls onResizeEnd once', () => {
    const { separator, onResizeEnd, unmount } = setup(splitOf('row', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 110 })
    expect(onResizeEnd).not.toHaveBeenCalled()
    unmount()

    expect(onResizeEnd).toHaveBeenCalledTimes(1)
  })

  it('A4 unmounting without a pointerdown calls no onResizeEnd', () => {
    const { onResizeEnd, unmount } = setup(splitOf('row', [px(200), FR]))

    unmount()

    expect(onResizeEnd).not.toHaveBeenCalled()
  })

  it('A4 unmounting after pointerup or pointercancel calls no second onResizeEnd', () => {
    const { separator, onResizeEnd, unmount } = setup(splitOf('row', [px(200), FR]))
    stubCapture(separator)

    fireEvent.pointerDown(separator, { pointerId: 1, clientX: 100 })
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 110 })
    fireEvent.pointerDown(separator, { pointerId: 2, clientX: 100 })
    fireEvent.pointerCancel(separator, { pointerId: 2 })
    expect(onResizeEnd).toHaveBeenCalledTimes(2)
    unmount()

    expect(onResizeEnd).toHaveBeenCalledTimes(2)
  })
})
