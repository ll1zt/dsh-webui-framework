// @vitest-environment happy-dom
import type { Context } from '@deepseek-ai/cordis'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

type Target = { blockId: string; contentId?: string }

/** Minimal block props: tab and layout record their calls, view is an empty layout. */
const fakeProps = (blockId: string, contentId: string) => ({
  blockId,
  contentId,
  active: true,
  layout: {
    open: vi.fn((_target: Target) => ({ ok: true })),
    close: vi.fn((_target: Target) => ({ ok: true })),
    activate: vi.fn((_target: Target) => ({ ok: true })),
    move: vi.fn((_target: Target) => ({ ok: true })),
    split: vi.fn((_target: Target) => ({ ok: true })),
  },
  tab: { setTitle: vi.fn((_title: unknown) => {}), setCloseGuard: vi.fn((_guard: (() => boolean) | null) => {}) },
  view: {
    getSnapshot: () => ({ version: 1, root: null, activePane: [] }),
    subscribe: () => () => {},
    isOpen: (_target: Target) => false,
    isActive: (_target: Target) => false,
  },
})

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

  it('A1 opens a new hello.note with a fresh contentId on every New note click', async () => {
    const HelloRoot = await registeredBlock('hello.root')
    const props = fakeProps('hello.root', '')

    render(createElement(HelloRoot, props))
    const button = screen.getByRole('button', { name: 'New note' })
    fireEvent.click(button)
    fireEvent.click(button)

    const open = props.layout.open
    expect(open).toHaveBeenCalledTimes(2)
    const [first, second] = open.mock.calls.map(([arg]) => arg) as [Target, Target]
    expect(first.blockId).toBe('hello.note')
    expect(second.blockId).toBe('hello.note')
    expect(first.contentId).toBeTruthy()
    expect(second.contentId).toBeTruthy()
    expect(first.contentId).not.toBe(second.contentId)
  })

  it('A2 titles the note tab from its contentId', async () => {
    const HelloNote = await registeredBlock('hello.note')
    const props = fakeProps('hello.note', 'n2')

    render(createElement(HelloNote, props))

    expect(props.tab.setTitle).toHaveBeenCalledWith({ en: 'Note 2', zh: '笔记 2' })
  })

  it('A3 vetoes closing while Unsaved changes is ticked and clears the guard otherwise', async () => {
    const HelloNote = await registeredBlock('hello.note')
    const props = fakeProps('hello.note', 'n1')
    const lastGuard = () => props.tab.setCloseGuard.mock.calls.at(-1)?.[0]

    const view = render(createElement(HelloNote, props))
    fireEvent.click(screen.getByLabelText('Unsaved changes'))

    const guard = lastGuard()
    expect(typeof guard).toBe('function')
    let verdict: unknown
    act(() => {
      verdict = (guard as () => boolean)()
    })
    expect(verdict).toBe(false)
    expect(screen.getByText('Close refused: unsaved changes')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Unsaved changes'))
    expect(lastGuard()).toBeNull()

    fireEvent.click(screen.getByLabelText('Unsaved changes'))
    expect(typeof lastGuard()).toBe('function')
    view.unmount()
    expect(lastGuard()).toBeNull()
  })
})
