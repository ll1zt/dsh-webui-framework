import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The 21 pi tokens the stylesheet defines on body (design doc 03 §3.2). */
const PI_TOKENS = [
  '--bg', '--bg-panel', '--bg-subtle', '--bg-hover', '--bg-selected', '--border',
  '--text', '--text-muted', '--text-dim', '--accent', '--accent-hover', '--accent-contrast',
  '--user-bg', '--assistant-bg', '--tool-bg', '--font-ui', '--font-mono',
  '--chat-content-font-size', '--chat-content-max-width', '--sidebar-width', '--right-panel-width',
]

/** Colour tokens that must alias the dsw palette; `--assistant-bg` is `transparent` and exempt. */
const COLOUR_TOKENS = [
  '--bg', '--bg-panel', '--bg-subtle', '--bg-hover', '--bg-selected', '--border',
  '--text', '--text-muted', '--text-dim', '--accent', '--accent-hover', '--accent-contrast',
  '--user-bg', '--tool-bg',
]

// Block comments are stripped so that a note mentioning a selector cannot satisfy or break the checks.
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const bodyBlock = /^\s*body\s*\{([^}]*)\}/m.exec(css)?.[1] ?? ''
const declared = new Map<string, string>()
for (const [, name = '', value = ''] of bodyBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
  declared.set(name, value.trim())
}

describe('tokens.css', () => {
  it('A5 defines all 21 pi tokens inside the body rule', () => {
    expect(PI_TOKENS.filter((name) => !declared.has(name))).toEqual([])
  })

  it('A5 colour tokens reference the dsw alias layer', () => {
    expect(COLOUR_TOKENS.filter((name) => !declared.get(name)?.includes('var(--dsw-alias-'))).toEqual([])
  })

  it('A5 never selects :root, since dsw palettes and overrides apply on body', () => {
    expect(css).not.toMatch(/:root\b/)
  })
})
