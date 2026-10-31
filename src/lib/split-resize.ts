import type { LayoutSize, LayoutSplit } from '@lllzt/dsh-webui-framework/contract'
import { clampSize } from './layout.ts'

/** Neither side of an fr pair may shrink below this share of the pair's sum. */
const MIN_FR_SHARE = 0.05

type PxSize = Extract<LayoutSize, { px: number }>
type FrSize = Extract<LayoutSize, { fr: number }>

function withSizes(split: LayoutSplit, index: number, pair: readonly [LayoutSize, LayoutSize]): LayoutSplit {
  return { ...split, sizes: split.sizes.map((size, i) => (i === index ? pair[0] : i === index + 1 ? pair[1] : size)) }
}

function resizePxPair(split: LayoutSplit, index: number, left: PxSize, right: PxSize, deltaPx: number): LayoutSplit {
  // Both sides move by the same amount, so the first limit either one hits stops them together.
  const lowest = Math.max(left.min - left.px, right.px - right.max)
  const highest = Math.min(left.max - left.px, right.px - right.min)
  const moved = Math.min(Math.max(deltaPx, lowest), highest)
  return withSizes(split, index, [
    clampSize({ ...left, px: left.px + moved }),
    clampSize({ ...right, px: right.px - moved }),
  ])
}

function resizeFrPair(
  split: LayoutSplit,
  index: number,
  left: FrSize,
  right: FrSize,
  deltaPx: number,
  containerPx: number,
): LayoutSplit {
  let pxTotal = 0
  let frTotal = 0
  for (const size of split.sizes) {
    if ('px' in size) pxTotal += size.px
    else frTotal += size.fr
  }
  const pxPerFr = (containerPx - pxTotal) / frTotal
  if (!Number.isFinite(pxPerFr) || pxPerFr <= 0) return split
  const sum = left.fr + right.fr
  const nextLeft = Math.min(Math.max(left.fr + deltaPx / pxPerFr, sum * MIN_FR_SHARE), sum * (1 - MIN_FR_SHARE))
  return withSizes(split, index, [{ fr: nextLeft }, { fr: sum - nextLeft }])
}

/**
 * Moves the separator between children `index` and `index + 1` by `deltaPx` (positive: toward the end)
 * and returns the split with its new sizes; the input is not changed.
 * @param containerPx - the length of the split along its axis, used to turn pixels into fr.
 */
export function dragResize(split: LayoutSplit, index: number, deltaPx: number, containerPx: number): LayoutSplit {
  const left = split.sizes[index]
  const right = split.sizes[index + 1]
  if (!Number.isInteger(index) || left === undefined || right === undefined) return split
  if ('px' in left && 'px' in right) return resizePxPair(split, index, left, right, deltaPx)
  if ('px' in left) return withSizes(split, index, [clampSize({ ...left, px: left.px + deltaPx }), right])
  if ('px' in right) return withSizes(split, index, [left, clampSize({ ...right, px: right.px - deltaPx })])
  return resizeFrPair(split, index, left, right, deltaPx, containerPx)
}
