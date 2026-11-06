// @vitest-environment happy-dom
import type {
  BlockInstanceProps,
  SessionBlockProps,
  WebuiSession,
  WebuiSessionState,
} from '@lllzt/dsh-webui-framework/contract'
import { act, cleanup, render } from '@testing-library/react'
import { Component, createElement, StrictMode, useEffect, useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { stateSourceOf, type WebuiSessionActions } from './session-adapter.ts'
import { bridgeSessionBlock, type SessionBridgeProps, type WebuiSessionStateHook } from './session-bridge.tsx'

/** The seven props a session block is allowed to see, in sorted order. */
const BLOCK_PROP_KEYS = ['active', 'blockId', 'contentId', 'layout', 'session', 'tab', 'view']

interface Fields {
  sessionId: string
  running: boolean
  blank: boolean
  removed: boolean
  openState: string
  lastAgentError: string | null
}

const INITIAL: Fields = {
  sessionId: 's1',
  running: false,
  blank: false,
  removed: false,
  openState: 'open',
  lastAgentError: null,
}

/**
 * A borrowed binding whose snapshot notifies subscribers. Typed as the adapter's parameter so this file
 * does not import the host session package.
 */
function fakeHostBinding(initial: Fields = INITIAL) {
  let fields = { ...initial }
  let extra: Record<string, unknown> = {}
  let current: Record<string, unknown> = { pendingSubmissions: [], hasMore: false, ...fields }
  const listeners = new Set<() => void>()
  const publish = (): void => {
    current = { pendingSubmissions: [], hasMore: false, ...fields, ...extra }
    for (const listener of listeners) listener()
  }
  const binding = {
    session: {
      getSnapshot: () => current,
      subscribe(listener: () => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
  } as unknown as Parameters<typeof stateSourceOf>[0]
  return {
    binding,
    setFields(partial: Partial<Fields>) {
      fields = { ...fields, ...partial }
      publish()
    },
    setExtra(next: Record<string, unknown>) {
      extra = next
      publish()
    },
  }
}

/**
 * Bind `stateSourceOf` the way the host binds a snapshot source.
 * Mirrors ref/deepseek-harness/packages/client/ui-renderer/src/client/bind.ts:20-26 without
 * `use-sync-external-store/with-selector` (no installed types). The source already returns the same
 * state object while the six contract fields are unchanged, so an unrelated host field does not re-render.
 */
function bindSessionHook(source: ReturnType<typeof stateSourceOf>): WebuiSessionStateHook {
  const subscribe = (listener: () => void): (() => void) => source.subscribe(listener)
  const getSnapshot = (): WebuiSessionState => source.getSnapshot()
  const useWebuiSession: WebuiSessionStateHook = (select) => {
    const state = useSyncExternalStore(subscribe, getSnapshot)
    return select(state)
  }
  return useWebuiSession
}

function passedProps(
  useWebuiSession: WebuiSessionStateHook,
  webuiSessionActions: WebuiSessionActions,
): SessionBridgeProps {
  return {
    blockId: 'block-1',
    contentId: 'content-1',
    active: true,
    layout: { marker: 'layout' } as unknown as BlockInstanceProps['layout'],
    tab: { marker: 'tab' } as unknown as BlockInstanceProps['tab'],
    view: { marker: 'view' } as unknown as BlockInstanceProps['view'],
    sessionId: 's1',
    useWebuiSession,
    webuiSessionActions,
  }
}

/** Host standard props and the inject face, which the block must not see. */
function withHostExtras(props: SessionBridgeProps): SessionBridgeProps {
  return {
    ...props,
    useSession: () => undefined,
    useProjection: () => undefined,
    useAccess: () => undefined,
  } as SessionBridgeProps
}

type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

function actionsOf(): {
  send: ReturnType<typeof vi.fn<(text: string, signal: AbortSignal) => Promise<ActionResult>>>
  stop: ReturnType<typeof vi.fn<(signal: AbortSignal) => Promise<ActionResult>>>
  webuiSessionActions: WebuiSessionActions
} {
  const send = vi.fn((_text: string, _signal: AbortSignal): Promise<ActionResult> => Promise.resolve({ ok: true }))
  const stop = vi.fn((_signal: AbortSignal): Promise<ActionResult> => Promise.resolve({ ok: true }))
  return { send, stop, webuiSessionActions: { send, stop } as unknown as WebuiSessionActions }
}

function expectOnlyBlockProps(received: object, passed: SessionBridgeProps): void {
  const props = received as SessionBlockProps
  expect(Object.keys(props).sort()).toEqual(BLOCK_PROP_KEYS)
  expect(props.blockId).toBe(passed.blockId)
  expect(props.contentId).toBe(passed.contentId)
  expect(props.active).toBe(passed.active)
  expect(props.layout).toBe(passed.layout)
  expect(props.tab).toBe(passed.tab)
  expect(props.view).toBe(passed.view)
  expect(props.session.sessionId).toBe(passed.sessionId)
}

const unusedHook = (() => false) as WebuiSessionStateHook

afterEach(() => {
  cleanup()
})

describe('session bridge', () => {
  it('A3 a bridged session block receives exactly the six block props plus session', () => {
    const { webuiSessionActions } = actionsOf()
    const passed = passedProps(unusedHook, webuiSessionActions)
    let seen: SessionBlockProps | undefined
    const Probe = (props: SessionBlockProps) => {
      seen = props
      return null
    }
    const Wrapped = bridgeSessionBlock(Probe)

    render(createElement(Wrapped, withHostExtras(passed)))

    if (seen === undefined) throw new Error('the block did not render')
    expectOnlyBlockProps(seen, passed)
  })

  it('A4 the block rerenders when running changes and not when only an unrelated host field changes', () => {
    const host = fakeHostBinding()
    const useWebuiSession = bindSessionHook(stateSourceOf(host.binding))
    const { webuiSessionActions } = actionsOf()
    const passed = passedProps(useWebuiSession, webuiSessionActions)
    let renders = 0
    const Probe = (props: SessionBlockProps) => {
      const running = props.session.useState((state) => state.running)
      renders += 1
      return createElement('span', null, running ? 'running' : 'idle')
    }
    const Wrapped = bridgeSessionBlock(Probe)

    const view = render(createElement(Wrapped, passed))
    expect(view.container.textContent).toBe('idle')
    const afterMount = renders

    act(() => {
      host.setExtra({ pendingSubmissions: [{ requestId: 'pending-1' }], hasMore: true })
    })
    expect(renders).toBe(afterMount)
    expect(view.container.textContent).toBe('idle')

    act(() => {
      host.setFields({ running: true })
    })
    expect(view.container.textContent).toBe('running')
    expect(renders).toBe(afterMount + 1)
  })

  it('A5 a rerender with a new props object does not remount the block and keeps the same session', () => {
    const { webuiSessionActions } = actionsOf()
    const passed = passedProps(unusedHook, webuiSessionActions)
    let mounts = 0
    const seen: WebuiSession[] = []
    const Probe = (props: SessionBlockProps) => {
      useEffect(() => {
        mounts += 1
      }, [])
      seen.push(props.session)
      return null
    }
    const Wrapped = bridgeSessionBlock(Probe)

    const view = render(createElement(Wrapped, passed))
    expect(mounts).toBe(1)
    const first = seen[0]
    view.rerender(createElement(Wrapped, { ...passed }))

    expect(mounts).toBe(1)
    expect(seen).toHaveLength(2)
    expect(seen[1]).toBe(first)
  })

  it('A6 a class session block receives session and the six block props', () => {
    const { webuiSessionActions } = actionsOf()
    const passed = passedProps(unusedHook, webuiSessionActions)
    let seen: SessionBlockProps | undefined
    class Probe extends Component<SessionBlockProps> {
      override render() {
        seen = this.props
        return null
      }
    }
    const Wrapped = bridgeSessionBlock(Probe)

    render(createElement(Wrapped, withHostExtras(passed)))

    if (seen === undefined) throw new Error('the class block did not render')
    expectOnlyBlockProps(seen, passed)
  })

  it('A7 send uses the mount signal and is cancelled on unmount, and does nothing before mount or after unmount', async () => {
    const { send, stop, webuiSessionActions } = actionsOf()
    const passed = passedProps(unusedHook, webuiSessionActions)
    let held: WebuiSession | undefined
    let duringRender: Promise<unknown> | undefined
    const Probe = (props: SessionBlockProps) => {
      held = props.session
      if (duringRender === undefined) duringRender = props.session.send('early')
      return null
    }
    const Wrapped = bridgeSessionBlock(Probe)

    const view = render(createElement(Wrapped, passed))
    const early = duringRender
    if (early === undefined || held === undefined) throw new Error('the block did not render')
    await early
    expect(await early).toEqual({ ok: false, reason: 'unmounted' })
    expect(send).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()

    await expect(held.send('hi')).resolves.toEqual({ ok: true })
    const signal = send.mock.calls[0]?.[1]
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toBe('hi')
    expect(signal).toBeInstanceOf(AbortSignal)
    if (!(signal instanceof AbortSignal)) throw new Error('send was not called with an AbortSignal')
    expect(signal.aborted).toBe(false)

    view.unmount()
    expect(signal.aborted).toBe(true)

    send.mockClear()
    stop.mockClear()
    await expect(held.send('later')).resolves.toEqual({ ok: false, reason: 'unmounted' })
    await expect(held.stop()).resolves.toEqual({ ok: false, reason: 'unmounted' })
    expect(send).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })

  it('A8 under StrictMode send and stop pass a signal that is not aborted', async () => {
    const { send, stop, webuiSessionActions } = actionsOf()
    const passed = passedProps(unusedHook, webuiSessionActions)
    let held: WebuiSession | undefined
    const Probe = (props: SessionBlockProps) => {
      held = props.session
      return null
    }
    const Wrapped = bridgeSessionBlock(Probe)

    render(createElement(StrictMode, null, createElement(Wrapped, passed)))
    if (held === undefined) throw new Error('the block did not render')

    await expect(held.send('hi')).resolves.toEqual({ ok: true })
    await expect(held.stop()).resolves.toEqual({ ok: true })

    const sendSignal = send.mock.calls[0]?.[1]
    const stopSignal = stop.mock.calls[0]?.[0]
    expect(send).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(sendSignal).toBeInstanceOf(AbortSignal)
    expect(stopSignal).toBeInstanceOf(AbortSignal)
    if (!(sendSignal instanceof AbortSignal) || !(stopSignal instanceof AbortSignal)) {
      throw new Error('the actions were not called with an AbortSignal')
    }
    expect(sendSignal.aborted).toBe(false)
    expect(stopSignal.aborted).toBe(false)
  })

  it('A3 send and stop resolve unmounted before the mount effect and after unmount, and pass host-refused through', async () => {
    const { send, stop, webuiSessionActions } = actionsOf()
    const passed = passedProps(unusedHook, webuiSessionActions)
    let held: WebuiSession | undefined
    let earlySend: Promise<unknown> | undefined
    let earlyStop: Promise<unknown> | undefined
    const Probe = (props: SessionBlockProps) => {
      held = props.session
      if (earlySend === undefined) earlySend = props.session.send('early')
      if (earlyStop === undefined) earlyStop = props.session.stop()
      return null
    }
    const Wrapped = bridgeSessionBlock(Probe)

    const view = render(createElement(Wrapped, passed))
    if (earlySend === undefined || earlyStop === undefined || held === undefined) {
      throw new Error('the block did not render')
    }
    await expect(earlySend).resolves.toEqual({ ok: false, reason: 'unmounted' })
    await expect(earlyStop).resolves.toEqual({ ok: false, reason: 'unmounted' })
    expect(send).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()

    const sendRefused = { ok: false as const, reason: 'host-refused' as const }
    const stopRefused = { ok: false as const, reason: 'host-refused' as const }
    send.mockResolvedValueOnce(sendRefused)
    await expect(held.send('hi')).resolves.toBe(sendRefused)
    stop.mockResolvedValueOnce(stopRefused)
    await expect(held.stop()).resolves.toBe(stopRefused)

    view.unmount()
    send.mockClear()
    stop.mockClear()
    await expect(held.send('later')).resolves.toEqual({ ok: false, reason: 'unmounted' })
    await expect(held.stop()).resolves.toEqual({ ok: false, reason: 'unmounted' })
    expect(send).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
  })
})
