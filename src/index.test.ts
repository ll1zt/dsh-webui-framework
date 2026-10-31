import { describe, expect, it } from 'vitest'
import { apply, Config } from './index.ts'

describe('Node half', () => {
  it('A1 Config accepts an empty object and an object with any layout, whose volatile ref reads back the same data', () => {
    const layout = { version: 1, root: null, activePane: [] }

    expect(Config({}).layout.get()).toBeUndefined()
    expect(Config({ layout }).layout.get()).toEqual(layout)
    expect(typeof apply).toBe('function')
  })

  it('A1 the layout field of Config carries the volatile metadata', () => {
    expect(Config.dict?.['layout']?.meta.volatile).toBe(true)
  })
})
