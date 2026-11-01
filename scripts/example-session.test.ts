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

/** Minimal block props: tab and layout record their calls, view is an empty layout whose canUndo / canRedo setCan flips. */
const fakeProps = (blockId: string, contentId: string) => {
  const can = { undo: false, redo: false }
  const listeners = new Set<() => void>()
  const unsubscribe = vi.fn()
  return {
    blockId,
    contentId,
    active: true,
    layout: {
      open: vi.fn((_target: Target) => ({ ok: true })),
      close: vi.fn((_target: Target) => ({ ok: true })),
      activate: vi.fn((_target: Target) => ({ ok: true })),
      move: vi.fn((_target: Target) => ({ ok: true })),
      split: vi.fn((_target: Target) => ({ ok: true })),
      resize: vi.fn((_target: Target, _size: unknown) => ({ ok: true })),
      resetToPreset: vi.fn(() => ({ ok: true })),
      undo: vi.fn(() => ({ ok: true })),
      redo: vi.fn(() => ({ ok: true })),
    },
    tab: { setTitle: vi.fn((_title: unknown) => {}), setCloseGuard: vi.fn((_guard: (() => boolean) | null) => {}) },
    view: {
      getSnapshot: () => ({ version: 1, root: null, activePane: [] }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          unsubscribe()
          listeners.delete(listener)
        }
      },
      isOpen: (_target: Target) => false,
      isActive: (_target: Target) => false,
      canUndo: () => can.undo,
      canRedo: () => can.redo,
      /** Test control: set what canUndo / canRedo report, then call every recorded listener. */
      setCan: (next: { undo?: boolean; redo?: boolean }) => {
        can.undo = next.undo ?? can.undo
        can.redo = next.redo ?? can.redo
        for (const listener of [...listeners]) listener()
      },
      unsubscribe,
    },
  }
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

  it('A1 the note block has a Note text box that shows what is typed', async () => {
    const HelloNote = await registeredBlock('hello.note')
    const props = fakeProps('hello.note', 'n1')

    render(createElement(HelloNote, props))
    const box = screen.getByRole('textbox', { name: 'Note text' }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: 'draft' } })

    expect(box.value).toBe('draft')
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

describe('example root undo / redo', () => {
  const others = ['open', 'close', 'activate', 'move', 'split', 'resize', 'resetToPreset'] as const

  it('A1 the root block shows Undo and Redo, disabled while the view says there is nothing to undo or redo', async () => {
    const HelloRoot = await registeredBlock('hello.root')
    const props = fakeProps('hello.root', '')
    render(createElement(HelloRoot, props))
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement
    expect([undo.disabled, redo.disabled]).toEqual([true, true])

    act(() => props.view.setCan({ undo: true }))
    expect([undo.disabled, redo.disabled]).toEqual([false, true])

    act(() => props.view.setCan({ undo: false, redo: true }))
    expect([undo.disabled, redo.disabled]).toEqual([true, false])

    act(() => props.view.setCan({ undo: true }))
    expect([undo.disabled, redo.disabled]).toEqual([false, false])
  })

  it('A2 Undo calls layout.undo once and Redo calls layout.redo once, nothing else', async () => {
    const HelloRoot = await registeredBlock('hello.root')
    const props = fakeProps('hello.root', '')
    props.view.setCan({ undo: true, redo: true })
    render(createElement(HelloRoot, props))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(props.layout.undo).toHaveBeenCalledTimes(1)
    expect(props.layout.redo).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    expect(props.layout.undo).toHaveBeenCalledTimes(1)
    expect(props.layout.redo).toHaveBeenCalledTimes(1)
    for (const name of others) expect(props.layout[name]).not.toHaveBeenCalled()
  })

  it('A3 re-renders through view.subscribe without remounting, and unsubscribes on unmount', async () => {
    const HelloRoot = await registeredBlock('hello.root')
    const props = fakeProps('hello.root', '')
    const view = render(createElement(HelloRoot, props))
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement
    expect(undo.disabled).toBe(true)

    act(() => props.view.setCan({ undo: true }))
    expect(screen.getByRole('button', { name: 'Undo' })).toBe(undo)
    expect(undo.disabled).toBe(false)

    expect(props.view.unsubscribe).not.toHaveBeenCalled()
    view.unmount()
    expect(props.view.unsubscribe).toHaveBeenCalled()
  })
})
