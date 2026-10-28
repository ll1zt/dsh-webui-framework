import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'

describe('messageOf', () => {
  it('A1 takes message from an Error and String() from anything else', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf('plain')).toBe('plain')
    expect(messageOf({ a: 1 })).toBe('[object Object]')
    expect(messageOf(undefined)).toBe('undefined')
  })
})

describe('isInvokedAsScript', () => {
  it('A2 is false without argv1 and compares the resolved path with the module file', () => {
    expect(isInvokedAsScript(undefined, 'file:///a/b.ts')).toBe(false)
    expect(isInvokedAsScript('/a/b.ts', 'file:///a/b.ts')).toBe(true)
    expect(isInvokedAsScript('/a/c.ts', 'file:///a/b.ts')).toBe(false)
  })

  it('A2 resolves a relative argv1 against the current working directory', () => {
    const moduleUrl = pathToFileURL(resolve('x/y.ts')).href
    expect(isInvokedAsScript('x/y.ts', moduleUrl)).toBe(true)
    expect(isInvokedAsScript('x/z.ts', moduleUrl)).toBe(false)
  })
})

describe('cli-utils single exit', () => {
  it('A3 no other script defines its own messageOf or invokedAsScript', () => {
    const dir = import.meta.dirname
    const offenders = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter(
        (p) =>
          /\.(ts|tsx|mjs|js)$/.test(p) && !p.includes('.test.') && !p.startsWith('fixtures') && p !== 'cli-utils.ts',
      )
      .filter((p) => {
        const text = readFileSync(join(dir, p), 'utf8')
        return text.includes('const messageOf') || text.includes('const invokedAsScript')
      })
    expect(offenders).toEqual([])
  })
})
