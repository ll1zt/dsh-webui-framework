import { describe, expect, it } from 'vitest'
import { isCompatibleContract } from './contract-version.ts'

describe('isCompatibleContract', () => {
  it('A1 treats 0.x as the same minor and 1.0 onward as the same major, and rejects an unparsable version', () => {
    const cases: readonly (readonly [host: string, plugin: string, compatible: boolean])[] = [
      ['0.4.0', '0.4.3', true],
      ['0.4.1', '0.4.0', true],
      ['0.4.0', '0.5.0', false],
      ['1.2.0', '1.9.0', true],
      ['1.2.0', '2.0.0', false],
      ['2.0.0', '1.9.9', false],
      ['0.9.0', '1.0.0', false],
      ['1.0.0', '0.9.9', false],
      ['x', '0.4.0', false],
      ['0.4.0', 'x', false],
      ['0.4', '0.4.0', false],
      ['0.4.0', '0.4', false],
      ['', '', false],
    ]
    for (const [host, plugin, compatible] of cases) {
      expect(isCompatibleContract(host, plugin), `${host} / ${plugin}`).toBe(compatible)
    }
  })
})
