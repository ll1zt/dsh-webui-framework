import { describe, expect, it } from 'vitest'
import { deepFreeze } from './deep-freeze.ts'

describe('deepFreeze', () => {
  it('A1 returns the same reference and freezes nested objects, arrays and objects inside arrays', () => {
    const value = { a: { b: 1 }, list: [{ c: 2 }, [3]] }

    expect(deepFreeze(value)).toBe(value)

    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.a)).toBe(true)
    expect(Object.isFrozen(value.list)).toBe(true)
    expect(Object.isFrozen(value.list[0])).toBe(true)
    expect(Object.isFrozen(value.list[1])).toBe(true)
  })

  it('A1 returns primitives and null as they are without throwing', () => {
    expect(deepFreeze(5)).toBe(5)
    expect(deepFreeze('s')).toBe('s')
    expect(deepFreeze(null)).toBeNull()
  })
})
