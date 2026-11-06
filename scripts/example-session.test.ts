// @vitest-environment happy-dom
import type { Context } from '@deepseek-ai/cordis'
import type { WebuiSession, WebuiSessionState } from '@lllzt/dsh-webui-framework/contract'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement, useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply } from '../examples/hello-block/src/client.tsx'

/** The host's Modal cannot load under vitest, so a stand-in records its props and renders a dialog while open. */
const modalProps = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement } = await import('react')
  return {
    Modal: (props: Record<string, unknown>) => {
      modalProps.push(props)
      if (!props.open) return null
      return createElement(
        'div',
        { role: 'dialog', 'aria-label': props.title as string },
        props.children as never,
        createElement('button', { type: 'button', onClick: props.onClose as () => void }, props.closeLabel as string),
      )
    },
  }
})

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

/**
 * Session stand-in. `useState` subscribes with React's `useSyncExternalStore` (no with-selector) and
 * `setRunning` replaces the state object, then notifies listeners inside `act`.
 */
const fakeSession = () => {
  let state: WebuiSessionState = {
    sessionId: 's1',
    running: false,
    blank: false,
    removed: false,
    openState: 'open',
    lastAgentError: null,
  }
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
  const send = vi.fn<(text: string) => Promise<boolean>>()
  const stop = vi.fn<() => Promise<boolean>>()
  const session: WebuiSession = {
    sessionId: 's1',
    useState(select) {
      return select(useSyncExternalStore(subscribe, () => state))
    },
    send,
    stop,
  }
  return {
    session,
    send,
    stop,
    setRunning(running: boolean) {
      act(() => {
        state = { ...state, running }
        for (const listener of [...listeners]) listener()
      })
    },
  }
}

/** Block props plus `session`. A new object on every call, so a rerender does not reuse the props reference. */
const sessionProps = (session: WebuiSession) => ({ ...fakeProps('hello.session', ''), session })

describe('example session block', () => {
  it('A1 loads the example client by a static import', () => {
    expect(typeof apply).toBe('function')
  })

  it('A3 shows a mount number that differs per mount and survives a rerender', async () => {
    const HelloSession = await registeredBlock('hello.session')
    const { session } = fakeSession()

    const first = render(createElement(HelloSession, sessionProps(session)))
    const firstNumber = mountNumber(first.container.textContent)
    first.rerender(createElement(HelloSession, sessionProps(session)))
    expect(mountNumber(first.container.textContent)).toBe(firstNumber)
    first.unmount()

    const second = render(createElement(HelloSession, sessionProps(session)))
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

  it('A1 shows Session s1 and idle, then running without remounting', async () => {
    const HelloSession = await registeredBlock('hello.session')
    const { session, setRunning } = fakeSession()
    const view = render(createElement(HelloSession, sessionProps(session)))
    const text = () => view.container.textContent ?? ''

    expect(text()).toContain('Session s1')
    expect(text()).toContain('idle')
    expect(text()).not.toContain('running')
    const mounted = mountNumber(text())

    setRunning(true)

    expect(text()).toContain('running')
    expect(text()).not.toContain('idle')
    expect(text()).toContain('Session s1')
    expect(mountNumber(text())).toBe(mounted)
  })

  it('A2 calls session.send once for Send hello and session.stop once for Stop, showing the verdict', async () => {
    const HelloSession = await registeredBlock('hello.session')
    const layoutActions = [
      'open',
      'close',
      'activate',
      'move',
      'split',
      'resize',
      'resetToPreset',
      'undo',
      'redo',
    ] as const
    const message = 'Hello from the example session block'

    const renderSession = () => {
      const fake = fakeSession()
      const props = sessionProps(fake.session)
      const view = render(createElement(HelloSession, props))
      return { fake, props, view }
    }
    const expectNoOtherAction = (
      fake: ReturnType<typeof fakeSession>,
      props: ReturnType<typeof sessionProps>,
      called: 'send' | 'stop',
    ) => {
      expect(fake.session[called === 'send' ? 'stop' : 'send']).not.toHaveBeenCalled()
      expect(props.tab.setTitle).not.toHaveBeenCalled()
      expect(props.tab.setCloseGuard).not.toHaveBeenCalled()
      for (const name of layoutActions) expect(props.layout[name]).not.toHaveBeenCalled()
    }

    {
      const { fake, props, view } = renderSession()
      fake.send.mockResolvedValue(true)
      fireEvent.click(screen.getByRole('button', { name: 'Send hello' }))
      expect(fake.send).toHaveBeenCalledTimes(1)
      expect(fake.send).toHaveBeenCalledWith(message)
      expectNoOtherAction(fake, props, 'send')
      expect(await screen.findByText('Sent')).toBeTruthy()
      expect(screen.queryByText('Send refused')).toBeNull()
      view.unmount()
    }

    {
      const { fake, props, view } = renderSession()
      fake.send.mockResolvedValue(false)
      fireEvent.click(screen.getByRole('button', { name: 'Send hello' }))
      expect(fake.send).toHaveBeenCalledTimes(1)
      expect(fake.send).toHaveBeenCalledWith(message)
      expectNoOtherAction(fake, props, 'send')
      expect(await screen.findByText('Send refused')).toBeTruthy()
      expect(screen.queryByText('Sent')).toBeNull()
      view.unmount()
    }

    {
      const { fake, props, view } = renderSession()
      fake.stop.mockResolvedValue(true)
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
      expect(fake.stop).toHaveBeenCalledTimes(1)
      expect(fake.stop).toHaveBeenCalledWith()
      expectNoOtherAction(fake, props, 'stop')
      expect(await screen.findByText('Stopped')).toBeTruthy()
      expect(screen.queryByText('Stop refused')).toBeNull()
      view.unmount()
    }

    {
      const { fake, props, view } = renderSession()
      fake.stop.mockResolvedValue(false)
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
      expect(fake.stop).toHaveBeenCalledTimes(1)
      expect(fake.stop).toHaveBeenCalledWith()
      expectNoOtherAction(fake, props, 'stop')
      expect(await screen.findByText('Stop refused')).toBeTruthy()
      expect(screen.queryByText('Stopped')).toBeNull()
      view.unmount()
    }
  })
})

describe('example root dialog', () => {
  it('A1 Open dialog shows a Hello dialog Modal and its onClose removes it', async () => {
    modalProps.length = 0
    const HelloRoot = await registeredBlock('hello.root')
    render(createElement(HelloRoot, fakeProps('hello.root', '')))
    for (const name of ['New note', 'Undo', 'Redo']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(modalProps.some((props) => props.open === true)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }))

    expect(modalProps.at(-1)).toMatchObject({ open: true, title: 'Hello dialog', closeLabel: 'Close' })
    expect(screen.getByRole('dialog', { name: 'Hello dialog' })).toBeTruthy()

    act(() => (modalProps.at(-1)?.onClose as () => void)())

    expect(screen.queryByRole('dialog')).toBeNull()
    for (const name of ['Open dialog', 'New note', 'Undo', 'Redo']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
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
