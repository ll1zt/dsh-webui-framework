// @vitest-environment happy-dom
import type { Context } from '@deepseek-ai/cordis'
import { cleanup, render } from '@testing-library/react'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../examples/hello-block/src/client.tsx'

afterEach(cleanup)

/** Runs the example's apply against a fake ctx and returns the component it registers for `blockId`. */
const registeredBlock = async (blockId: string): Promise<ComponentType<Record<string, unknown>>> => {
  const blocks = new Map<string, ComponentType<Record<string, unknown>>>()
  const layout = {
    registerBlock: (meta: { id: string }, component: ComponentType<Record<string, unknown>>) => {
      blocks.set(meta.id, component)
      return () => {}
    },
    registerPreset: () => () => {},
  }
  const fakeCtx = {
    webuiLayout: layout,
    inject: (_keys: string[], callback: (ctx: unknown) => unknown) => callback(fakeCtx),
  }
  apply(fakeCtx as unknown as Context)
  const component = blocks.get(blockId)
  if (!component) throw new Error(`${blockId} was not registered`)
  return component
}

const mountNumber = (text: string | null): number => {
  const match = /mount #(\d+)/.exec(text ?? '')
  if (!match) throw new Error(`no "mount #<n>" in ${JSON.stringify(text)}`)
  return Number(match[1])
}

describe('example session block', () => {
  it('A1 loads the example client by a static import', () => {
    expect(typeof apply).toBe('function')
  })

  it('A3 shows a mount number that differs per mount and survives a rerender', async () => {
    const HelloSession = await registeredBlock('hello.session')

    const first = render(createElement(HelloSession, { tick: 1 }))
    const firstNumber = mountNumber(first.container.textContent)
    first.rerender(createElement(HelloSession, { tick: 2 }))
    expect(mountNumber(first.container.textContent)).toBe(firstNumber)
    first.unmount()

    const second = render(createElement(HelloSession, { tick: 1 }))
    expect(mountNumber(second.container.textContent)).toBeGreaterThan(firstNumber)
  })
})
