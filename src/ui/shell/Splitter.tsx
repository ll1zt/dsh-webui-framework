/** The draggable, focusable bar between two cells of a split; pointer and keyboard both go through dragResize. */
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { LayoutSize, LayoutSplit } from '@lllzt/dsh-webui-framework/contract'
import { dragResize } from '../../lib/split-resize.ts'

export interface SplitterProps {
  split: LayoutSplit
  /** The separator sits between children `index` and `index + 1`. */
  index: number
  /** The split's current length along its axis, read when a resize is computed. */
  containerPx: () => number
  onResize: (next: LayoutSplit) => void
  label: string
}

const KEY_STEP = 8
const KEY_STEP_SHIFT = 32

interface Drag {
  start: number
  split: LayoutSplit
}

/** The px side whose size the separator reports, and which way growing it moves the separator. */
function valueSide(
  split: LayoutSplit,
  index: number,
): { size: Extract<LayoutSize, { px: number }>; sign: 1 | -1 } | undefined {
  const left = split.sizes[index]
  if (left !== undefined && 'px' in left) return { size: left, sign: 1 }
  const right = split.sizes[index + 1]
  if (right !== undefined && 'px' in right) return { size: right, sign: -1 }
  return undefined
}

export function Splitter({ split, index, containerPx, onResize, label }: SplitterProps): ReactNode {
  const drag = useRef<Drag | null>(null)
  const isRow = split.axis === 'row'
  const side = valueSide(split, index)

  const resizeBy = (deltaPx: number, from: LayoutSplit = split): void => {
    onResize(dragResize(from, index, deltaPx, containerPx()))
  }

  const keyDelta = (event: KeyboardEvent): number | undefined => {
    const step = event.shiftKey ? KEY_STEP_SHIFT : KEY_STEP
    switch (event.key) {
      case isRow ? 'ArrowRight' : 'ArrowDown':
        return step
      case isRow ? 'ArrowLeft' : 'ArrowUp':
        return -step
      case 'Home':
      case 'End': {
        if (side === undefined) return undefined
        const target = event.key === 'Home' ? side.size.min : side.size.max
        return (target - side.size.px) * side.sign
      }
      default:
        return undefined
    }
  }

  const coordinate = (event: PointerEvent): number => (isRow ? event.clientX : event.clientY)

  return (
    <div
      className="webui-dock-splitter"
      data-axis={split.axis}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={isRow ? 'vertical' : 'horizontal'}
      {...(side === undefined
        ? {}
        : { 'aria-valuenow': side.size.px, 'aria-valuemin': side.size.min, 'aria-valuemax': side.size.max })}
      onKeyDown={(event) => {
        const delta = keyDelta(event)
        if (delta === undefined) return
        event.preventDefault()
        resizeBy(delta)
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { start: coordinate(event), split }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (current !== null) resizeBy(coordinate(event) - current.start, current.split)
      }}
      onPointerUp={(event) => {
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={(event) => {
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
    />
  )
}
