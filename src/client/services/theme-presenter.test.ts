// @vitest-environment happy-dom
import type { ThemeDefinition, ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemePresenter } from './theme-presenter.ts'

const LIGHT: ThemeDefinition = { id: 'light', colorScheme: 'light', tokens: { '--bg': '#ffffff', '--text': '#111111' } }
const DARK: ThemeDefinition = { id: 'dark', colorScheme: 'dark', tokens: { '--bg': '#000000', '--accent': '#ff0000' } }

/** A resolved snapshot with the light theme active unless overridden. */
function snapshot(overrides: Partial<ThemeSnapshot> = {}): ThemeSnapshot {
  return {
    preference: 'light',
    fontSizes: { text: 14, code: 11, terminal: 12 },
    fontFamilies: { text: '', code: '', terminal: '' },
    active: LIGHT,
    themes: [LIGHT, DARK],
    revision: 1,
    ...overrides,
  }
}

/** Every custom property the body inline style carries, sorted. */
function bodyCustomProperties(): string[] {
  return Array.from(document.body.style)
    .filter((name) => name.startsWith('--'))
    .sort()
}

describe('ThemePresenter', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style')
    document.documentElement.removeAttribute('data-ds-theme-source')
    document.body.removeAttribute('style')
    document.body.removeAttribute('data-ds-dark-theme')
    for (const meta of document.head.querySelectorAll('meta')) meta.remove()
  })

  it('A1 dark snapshot sets color-scheme and the dark attribute, light removes it', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot({ preference: 'dark', active: DARK }))
    expect(document.documentElement.style.colorScheme).toBe('dark')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(true)

    presenter.apply(snapshot({ preference: 'light', active: LIGHT }))
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
  })

  it('A1 preference system publishes "system" on html[data-ds-theme-source]', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot({ preference: 'system', active: DARK }))
    expect(document.documentElement.getAttribute('data-ds-theme-source')).toBe('system')
  })

  it('A2 a second snapshot leaves only its own tokens on body', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot({ preference: 'dark', active: DARK }))
    presenter.apply(snapshot({ active: LIGHT }))
    // The font-size variables are not tokens; only the token names are compared here.
    expect(bodyCustomProperties().filter((name) => !name.startsWith('--dsh-'))).toEqual(
      Object.keys(LIGHT.tokens).sort(),
    )
    expect(document.body.style.getPropertyValue('--bg')).toBe('#ffffff')
  })

  it('A3 a font size publishes as px on body', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot({ fontSizes: { text: 15, code: 11, terminal: 12 } }))
    expect(document.body.style.getPropertyValue('--dsh-content-font-size')).toBe('15px')
  })

  it('A3 an empty font family list removes its variable from body', () => {
    const presenter = new ThemePresenter()
    presenter.apply(snapshot({ fontFamilies: { text: '', code: 'Fira Code', terminal: '' } }))
    expect(document.body.style.getPropertyValue('--dsh-font-family-code')).toBe('Fira Code')

    presenter.apply(snapshot({ fontFamilies: { text: '', code: '', terminal: '' } }))
    expect(document.body.style.getPropertyValue('--dsh-font-family-code')).toBe('')
  })

  it('A4 apply keeps exactly one theme-color meta carrying the body background', () => {
    document.body.style.backgroundColor = 'rgb(1, 2, 3)'
    const presenter = new ThemePresenter()
    presenter.apply(snapshot({ preference: 'dark', active: DARK }))
    presenter.apply(snapshot({ active: LIGHT }))
    const metas = [...document.head.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
    expect(metas).toHaveLength(1)
    expect(metas[0]?.content).toBe(getComputedStyle(document.body).backgroundColor)
  })

  it('A4 dispose retracts the meta and every write, but keeps foreign body style', () => {
    document.body.style.backgroundColor = 'rgb(1, 2, 3)'
    const presenter = new ThemePresenter()
    presenter.apply(snapshot({ preference: 'dark', active: DARK, fontSizes: { text: 15, code: 11, terminal: 12 } }))
    presenter.dispose()
    expect(document.head.querySelectorAll('meta[name="theme-color"]')).toHaveLength(0)
    expect(document.body.hasAttribute('data-ds-dark-theme')).toBe(false)
    expect(document.documentElement.hasAttribute('data-ds-theme-source')).toBe(false)
    expect(document.documentElement.style.colorScheme).toBe('')
    expect(bodyCustomProperties()).toEqual([])
    expect(document.body.style.backgroundColor).toBe('rgb(1, 2, 3)')
  })
})
