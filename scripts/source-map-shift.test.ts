import { describe, expect, it } from 'vitest'
import { collapseWhitespace, shiftMappings } from './source-map-shift.ts'

describe('shiftMappings', () => {
  it('A1 a positive shift prepends empty lines and zero returns the input untouched', () => {
    expect(shiftMappings('AAAA;AACA', 2)).toBe(';;AAAA;AACA')
    expect(shiftMappings('AAAA;AACA', 0)).toBe('AAAA;AACA')
  })

  it('A2 a negative shift drops leading lines and yields an empty string when none are left', () => {
    expect(shiftMappings(';;AAAA;AACA', -2)).toBe('AAAA;AACA')
    expect(shiftMappings('AAAA;AACA', -5)).toBe('')
  })
})

describe('collapseWhitespace', () => {
  it('A3 folds whitespace runs into one space and trims the ends', () => {
    expect(collapseWhitespace('  a \n\t b  ')).toBe('a b')
    expect(collapseWhitespace(' \n\t ')).toBe('')
  })
})
