// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { styleInjectionModule } from './css-inject.ts'

const PLUGIN_ID = '@lllzt/dsh-web-ui'
const A_FILE = 'src/ui/a/a.css'
const B_FILE = 'src/ui/b/b.css'
const A_CSS = '.a{color:red}'
const B_CSS = '.b{color:blue}'
const TAGS = `${PLUGIN_ID}/${A_FILE} ${PLUGIN_ID}/${B_FILE}`
const CSS = `${A_CSS}\n${B_CSS}`

/** Run a generated injection module the way the bundle does: `document` is its only free variable. */
const run = (text: string, doc: Document | undefined): void => {
  new Function('document', text)(doc)
}

const pluginStyles = (): HTMLStyleElement[] => [
  ...document.querySelectorAll<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`),
]

describe('styleInjectionModule', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
  })

  it('A1 two sheets share one style tag', () => {
    run(styleInjectionModule(PLUGIN_ID, A_FILE, A_CSS), document)
    run(styleInjectionModule(PLUGIN_ID, B_FILE, B_CSS), document)
    const tags = pluginStyles()
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toBe(CSS)
    expect(tags[0]?.getAttribute('data-plugin-css')).toBe(TAGS)
  })

  it('A1 creates the tag in head even when body already holds one', () => {
    const bodyTag = document.createElement('style')
    bodyTag.dataset.plugin = PLUGIN_ID
    bodyTag.textContent = '.body{color:black}'
    document.body.appendChild(bodyTag)

    run(styleInjectionModule(PLUGIN_ID, A_FILE, A_CSS), document)

    const headTag = document.head.querySelector<HTMLStyleElement>(`style[data-plugin="${PLUGIN_ID}"]`)
    expect(headTag).not.toBeNull()
    expect(headTag).not.toBe(bodyTag)
    expect(headTag?.textContent).toBe(A_CSS)
    expect(bodyTag.textContent).toBe('.body{color:black}')
    expect(bodyTag.hasAttribute('data-plugin-css')).toBe(false)
  })

  it('A2 rerunning both sheets leaves the tag unchanged', () => {
    run(styleInjectionModule(PLUGIN_ID, A_FILE, A_CSS), document)
    run(styleInjectionModule(PLUGIN_ID, B_FILE, B_CSS), document)
    run(styleInjectionModule(PLUGIN_ID, A_FILE, A_CSS), document)
    run(styleInjectionModule(PLUGIN_ID, B_FILE, B_CSS), document)
    const tags = pluginStyles()
    expect(tags).toHaveLength(1)
    expect(tags[0]?.textContent).toBe(CSS)
    expect(tags[0]?.getAttribute('data-plugin-css')).toBe(TAGS)
  })

  it('A3 leaves a foreign plugin style untouched', () => {
    const foreign = document.createElement('style')
    foreign.dataset.plugin = 'other-plugin'
    foreign.textContent = '.x{color:green}'
    document.head.appendChild(foreign)
    const before = foreign.outerHTML
    run(styleInjectionModule(PLUGIN_ID, A_FILE, A_CSS), document)
    run(styleInjectionModule(PLUGIN_ID, B_FILE, B_CSS), document)
    expect(foreign.outerHTML).toBe(before)
    expect(foreign.textContent).toBe('.x{color:green}')
    expect(pluginStyles()).toHaveLength(1)
  })

  it('A4 runs without a document and does not throw', () => {
    const text = styleInjectionModule(PLUGIN_ID, A_FILE, A_CSS)
    expect(() => run(text, undefined)).not.toThrow()
  })
})
