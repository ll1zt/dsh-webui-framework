import { act } from 'react'
import { describe, expect, it } from 'vitest'

describe('vitest process environment', () => {
  it('A1 the test process runs with NODE_ENV test whatever the launching shell exported', () => {
    expect(process.env.NODE_ENV).toBe('test')
  })

  // React picks its build when first loaded. The production build has no React.act, and
  // @testing-library/react's act() then throws "act(...) is not supported in production builds of React".
  it('A2 React loads its development build so act() works', () => {
    expect(typeof act).toBe('function')
    expect(() => act(() => {})).not.toThrow()
  })
})
