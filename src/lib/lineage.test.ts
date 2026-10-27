import { describe, expect, it } from 'vitest'
import type { LineageInput, LineageRow } from './lineage.ts'
import { flattenSessionLineage } from './lineage.ts'

const row = (sessionId: string, parentSessionId?: string): LineageInput =>
  parentSessionId === undefined ? { sessionId } : { sessionId, parentSessionId }

const ids = (rows: readonly LineageRow[]): string[] => rows.map(entry => entry.sessionId)
const depths = (rows: readonly LineageRow[]): number[] => rows.map(entry => entry.depth)

describe('flattenSessionLineage', () => {
  it('TestLineage_A5 keeps input order and lets children follow their parent', () => {
    const rows = flattenSessionLineage([
      row('a'),
      row('a-child-1', 'a'),
      row('b'),
      row('a-child-2', 'a'),
      row('a-grandchild', 'a-child-1'),
    ])

    expect(ids(rows)).toEqual(['a', 'a-child-1', 'a-grandchild', 'a-child-2', 'b'])
    expect(depths(rows)).toEqual([0, 1, 2, 1, 0])
  })

  it('TestLineage_A5 moves a child that arrives before its parent behind it', () => {
    const rows = flattenSessionLineage([row('late-child', 'late-parent'), row('late-parent')])

    expect(ids(rows)).toEqual(['late-parent', 'late-child'])
    expect(depths(rows)).toEqual([0, 1])
  })

  it('TestLineage_A5 demotes an orphan whose parent is not in the input', () => {
    const rows = flattenSessionLineage([row('missing-child', 'not-listed'), row('plain')])

    expect(ids(rows)).toEqual(['missing-child', 'plain'])
    expect(depths(rows)).toEqual([0, 0])
  })

  it('TestLineage_A5 emits each cycle member exactly once and terminates', () => {
    const input = [row('cycle-a', 'cycle-b'), row('cycle-b', 'cycle-a'), row('before'), row('after')]
    const rows = flattenSessionLineage(input)

    expect(ids(rows)).toHaveLength(4)
    expect(new Set(ids(rows))).toEqual(new Set(['cycle-a', 'cycle-b', 'before', 'after']))
    expect(rows.filter(entry => entry.depth === 0)).not.toHaveLength(0)
  })

  it('TestLineage_A5 treats a self-parented session as a root once', () => {
    const rows = flattenSessionLineage([row('self', 'self'), row('other')])

    expect(ids(rows)).toHaveLength(2)
    expect(new Set(ids(rows))).toEqual(new Set(['self', 'other']))
    expect(depths(rows)).toEqual([0, 0])
  })
})
