// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { PANE_ATTRIBUTE, focusActiveTab, panePathOfElement } from './pane-dom.ts'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('panePathOfElement', () => {
  it('A5 names the marker attribute data-webui-pane', () => {
    expect(PANE_ATTRIBUTE).toBe('data-webui-pane')
  })

  it('A5 reads the path from the marked element and from its descendants', () => {
    const host = mount('<div data-webui-pane="1.0"><section><span id="deep"></span></section></div>')

    expect(panePathOfElement(host.firstElementChild)).toEqual([1, 0])
    expect(panePathOfElement(host.querySelector('#deep'))).toEqual([1, 0])
  })

  it('A5 reads an empty value as the root pane', () => {
    const host = mount('<div data-webui-pane=""><span id="inner"></span></div>')

    expect(panePathOfElement(host.querySelector('#inner'))).toEqual([])
  })

  it('A5 gives undefined for null and for elements outside any pane', () => {
    const host = mount('<div><span id="free"></span></div>')

    expect(panePathOfElement(null)).toBeUndefined()
    expect(panePathOfElement(host.querySelector('#free'))).toBeUndefined()
  })

  it('A5 gives undefined for a value that is not a dotted index path', () => {
    const host = mount('<div data-webui-pane="a"></div><div data-webui-pane="1..0"></div>')

    expect(panePathOfElement(host.children[0] ?? null)).toBeUndefined()
    expect(panePathOfElement(host.children[1] ?? null)).toBeUndefined()
  })
})

describe('focusActiveTab', () => {
  const PANES = `
    <div data-webui-pane="0">
      <button role="tab" aria-selected="false" id="a0">a</button>
      <button role="tab" aria-selected="true" id="a1">b</button>
    </div>
    <div data-webui-pane="1.0">
      <button role="tab" aria-selected="true" id="c0">c</button>
    </div>`

  it('A5 focuses the selected tab button of the named pane and returns true', () => {
    const host = mount(PANES)

    expect(focusActiveTab(host, [0])).toBe(true)
    expect(document.activeElement?.id).toBe('a1')
    expect(focusActiveTab(host, [1, 0])).toBe(true)
    expect(document.activeElement?.id).toBe('c0')
  })

  it('A5 returns false when the pane or its selected tab button is absent', () => {
    const host = mount(
      `${PANES}<div data-webui-pane="2"><button role="tab" aria-selected="false" id="d0">d</button></div>`,
    )

    expect(focusActiveTab(host, [3])).toBe(false)
    expect(focusActiveTab(host, [2])).toBe(false)
    expect(document.activeElement).toBe(document.body)
  })
})
