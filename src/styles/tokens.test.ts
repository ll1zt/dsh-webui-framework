import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The 15 neutral tokens the stylesheet defines on body, and nothing else. */
const TOKENS = [
  '--bg',
  '--bg-panel',
  '--bg-subtle',
  '--bg-hover',
  '--bg-selected',
  '--border',
  '--text',
  '--text-muted',
  '--text-dim',
  '--accent',
  '--accent-hover',
  '--accent-contrast',
  '--font-ui',
  '--font-mono',
  '--content-font-size',
]

/** The 12 colour tokens that must alias the dsw palette. */
const COLOUR_TOKENS = TOKENS.slice(0, 12)

// Block comments are stripped so that a note mentioning a selector cannot satisfy or break the checks.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const bodyBlock = /^\s*body\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
const declared = new Map<string, string>()
for (const [, name = '', value = ''] of bodyBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  declared.set(name, value.trim())
}

describe('tokens.css', () => {
  it('A1 the body rule defines exactly the 15 neutral tokens', () => {
    expect([...declared.keys()].sort()).toEqual([...TOKENS].sort())
  })

  it('A1 the 12 colour tokens reference the dsw alias layer', () => {
    expect(COLOUR_TOKENS.filter((name) => !declared.get(name)?.includes('var(--dsw-alias-'))).toEqual([])
  })

  it('A1 --content-font-size references --dsh-content-font-size', () => {
    expect(declared.get('--content-font-size')).toContain('var(--dsh-content-font-size')
  })

  it('A1 never selects :root, since dsw palettes and overrides apply on body', () => {
    expect(css).not.toMatch(/:root\b/)
  })
})
