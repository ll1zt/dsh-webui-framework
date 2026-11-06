import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The 21 tokens the stylesheet defines on body, and nothing else. */
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
  '--state-error-fg',
  '--state-error-bg',
  '--state-warning-fg',
  '--state-warning-bg',
  '--state-success-fg',
  '--state-success-bg',
  '--font-ui',
  '--font-mono',
  '--content-font-size',
]

/** The 18 colour tokens that must alias the dsw palette. */
const COLOUR_TOKENS = TOKENS.slice(0, 18)

/**
 * State colours alias the host `--dsw-alias-state-*` ramps.
 * Warning is spelled `warn` there (`--dsw-alias-state-warn-*`), not `warning`.
 */
const STATE_COLOURS = [
  ['--state-error-fg', 'error'],
  ['--state-error-bg', 'error'],
  ['--state-warning-fg', 'warn'],
  ['--state-warning-bg', 'warn'],
  ['--state-success-fg', 'success'],
  ['--state-success-bg', 'success'],
] as const

// Block comments are stripped so that a note mentioning a selector cannot satisfy or break the checks.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const bodyBlock = /^\s*body\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
const declared = new Map<string, string>()
for (const [, name = '', value = ''] of bodyBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  declared.set(name, value.trim())
}

describe('tokens.css', () => {
  it('A1 the body rule defines exactly the 21 tokens', () => {
    expect([...declared.keys()].sort()).toEqual([...TOKENS].sort())
  })

  it('A1 the 18 colour tokens reference the dsw alias layer', () => {
    expect(COLOUR_TOKENS.filter((name) => !declared.get(name)?.includes('var(--dsw-alias-'))).toEqual([])
  })

  it('A1 --content-font-size references --dsh-content-font-size', () => {
    expect(declared.get('--content-font-size')).toContain('var(--dsh-content-font-size')
  })

  it('A1 never selects :root, since dsw palettes and overrides apply on body', () => {
    expect(css).not.toMatch(/:root\b/)
  })

  it('A2 state colours reference var(--dsw-alias-state-) for error, warning and success', () => {
    for (const [name, state] of STATE_COLOURS) {
      const value = declared.get(name) ?? ''
      expect(value, name).toContain(`var(--dsw-alias-state-${state}-`)
      expect(value, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/i)
    }
    const outsideBody = css.replace(/^\s*body\s*\{[^}]*\}/m, '')
    expect(outsideBody).not.toMatch(/--[\w-]+\s*:/)
  })
})
