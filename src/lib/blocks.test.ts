import { describe, expect, it } from 'vitest'
import type { BlockKind } from './blocks.ts'
import { BLOCK_CATALOG } from './blocks.ts'

const KINDS: readonly BlockKind[] = ['sessions', 'files', 'session', 'viewer']

describe('BLOCK_CATALOG', () => {
  it('A5 holds exactly the four block kinds, each keyed by its own kind', () => {
    expect(Object.keys(BLOCK_CATALOG).sort()).toEqual([...KINDS].sort())
    for (const kind of KINDS) expect(BLOCK_CATALOG[kind].kind).toBe(kind)
  })

  it('A5 session is session-scoped and cannot be closed', () => {
    expect(BLOCK_CATALOG.session.scope).toBe('session')
    expect(BLOCK_CATALOG.session.closable).toBe(false)
  })

  it('A5 viewer is multi-instance and the others are single-instance', () => {
    expect(BLOCK_CATALOG.viewer.multiInstance).toBe(true)
    for (const kind of ['sessions', 'files', 'session'] as const) expect(BLOCK_CATALOG[kind].multiInstance).toBe(false)
  })

  it('A5 sessions, files and viewer are root-scoped', () => {
    for (const kind of ['sessions', 'files', 'viewer'] as const) expect(BLOCK_CATALOG[kind].scope).toBe('root')
  })
})
