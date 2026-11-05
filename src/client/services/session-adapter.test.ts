import type { ISessions, SessionBinding, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LOG_PREFIX } from './log-prefix.ts'
import type { WebuiSessionActions, WebuiSessionInject } from './session-adapter.ts'
import { sessionActionsOf, sessionInjectFor, stateSourceOf, toWebuiSessionState } from './session-adapter.ts'

interface Fields {
  sessionId: string
  running: boolean
  blank: boolean
  removed: boolean
  openState: string
  lastAgentError: string | null
}

type HostAnswer = { ok: boolean }

const INITIAL: Fields = {
  sessionId: 's1',
  running: false,
  blank: false,
  removed: false,
  openState: 'open',
  lastAgentError: null,
}

/** A host snapshot. Only the six contract fields are required; extra keys stand in for the rest. */
function snapshot(fields: Fields = INITIAL, extra: Record<string, unknown> = {}): SessionSnapshot {
  return { pendingSubmissions: [], hasMore: false, ...fields, ...extra } as unknown as SessionSnapshot
}

/**
 * A plain SessionBinding: getSnapshot / subscribe / prompt / cancel, cast to the host type.
 * `setSnapshot` swaps the object `getSnapshot` returns.
 */
function fakeBinding(fields: Fields = INITIAL) {
  let current = snapshot(fields)
  const subscribe = vi.fn((_listener: () => void) => () => {})
  const prompt = vi.fn((_content: unknown, _mode: unknown, _signal: unknown): Promise<HostAnswer> => {
    return Promise.resolve({ ok: true })
  })
  const cancel = vi.fn((): Promise<HostAnswer> => Promise.resolve({ ok: true }))
  const binding = {
    sessionId: fields.sessionId,
    session: { getSnapshot: () => current, subscribe, prompt, cancel },
    eventSource: {},
    ctx: {},
  } as unknown as SessionBinding
  return {
    binding,
    subscribe,
    prompt,
    cancel,
    setSnapshot(next: SessionSnapshot) {
      current = next
    },
  }
}

/** `binding(id)` is the only host method the adapter calls. */
function fakeSessions(lookup: (id: string) => SessionBinding | undefined): ISessions {
  return { binding: (id: string) => lookup(id) } as unknown as ISessions
}

/** Actions for `fake`, with `sessions.binding` returning whatever `resolve` returns for its id. */
function actionsFor(
  fake: ReturnType<typeof fakeBinding>,
  sessionId: string,
  resolve: () => SessionBinding | undefined,
): WebuiSessionActions {
  return sessionActionsOf(
    fakeSessions((id) => (id === sessionId ? resolve() : undefined)),
    fake.binding,
  )
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const consoleWarn: { spy: ReturnType<typeof vi.spyOn> | undefined } = { spy: undefined }

beforeEach(() => {
  consoleWarn.spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

function warnSpy(): ReturnType<typeof vi.spyOn> {
  const spy = consoleWarn.spy
  if (spy === undefined) throw new Error('console.warn spy was not installed')
  return spy
}

/** Every warn argument, so a sent string hidden in an object still counts. */
function warnText(): string {
  return warnSpy()
    .mock.calls.map((call: readonly unknown[]) =>
      call
        .map((part: unknown) => {
          if (typeof part === 'string') return part
          if (part instanceof Error) return `${part.name}: ${part.message}`
          try {
            return JSON.stringify(part)
          } catch {
            return String(part)
          }
        })
        .join(' '),
    )
    .join('\n')
}

describe('session adapter', () => {
  it('A1 maps the six snapshot fields and unknown openState to error', () => {
    expect(
      toWebuiSessionState(
        snapshot(
          {
            sessionId: 'sid-9',
            running: true,
            blank: false,
            removed: true,
            openState: 'loading',
            lastAgentError: 'agent blew up',
          },
          { pendingSubmissions: [{ requestId: 'p' }], hasMore: true },
        ),
      ),
    ).toEqual({
      sessionId: 'sid-9',
      running: true,
      blank: false,
      removed: true,
      openState: 'loading',
      lastAgentError: 'agent blew up',
    })

    for (const openState of ['cold', 'loading', 'open', 'error']) {
      expect(toWebuiSessionState(snapshot({ ...INITIAL, openState })).openState).toBe(openState)
    }
    expect(toWebuiSessionState(snapshot({ ...INITIAL, openState: 'closed' })).openState).toBe('error')
  })

  it('A2 returns the same state object until one of the six fields changes', () => {
    let fields: Fields = { ...INITIAL, sessionId: 'sid' }
    const fake = fakeBinding(fields)
    const source = stateSourceOf(fake.binding)
    const first = source.getSnapshot()
    expect(source.getSnapshot()).toBe(first)
    expect(first).toEqual({
      sessionId: 'sid',
      running: false,
      blank: false,
      removed: false,
      openState: 'open',
      lastAgentError: null,
    })

    fake.setSnapshot(snapshot(fields, { pendingSubmissions: [{ requestId: 'pending-1' }], hasMore: true }))
    expect(source.getSnapshot()).toBe(first)

    const updates: Array<Partial<Fields>> = [
      { running: true },
      { blank: true },
      { removed: true },
      { openState: 'loading' },
      { lastAgentError: 'agent' },
      { sessionId: 'sid-2' },
    ]
    let previous = first
    for (const update of updates) {
      fields = { ...fields, ...update }
      fake.setSnapshot(snapshot(fields, { pendingSubmissions: [{ requestId: 'pending-1' }], hasMore: true }))
      const next = source.getSnapshot()
      expect(next, JSON.stringify(update)).not.toBe(previous)
      expect(next).toMatchObject(update)
      previous = next
    }
  })

  it('A2 subscribes only when asked and returns the host unsubscribe', () => {
    const fake = fakeBinding()
    const source = stateSourceOf(fake.binding)
    expect(fake.subscribe).not.toHaveBeenCalled()
    source.getSnapshot()
    expect(fake.subscribe).not.toHaveBeenCalled()

    const listener = (): void => {}
    const unsubscribe = vi.fn()
    fake.subscribe.mockReturnValueOnce(unsubscribe)
    expect(source.subscribe(listener)).toBe(unsubscribe)
    expect(fake.subscribe).toHaveBeenCalledTimes(1)
    expect(fake.subscribe).toHaveBeenCalledWith(listener)
  })

  it('A2 warns once for an unknown openState', () => {
    const fields: Fields = { ...INITIAL, openState: 'not-a-state' }
    const fake = fakeBinding(fields)
    const source = stateSourceOf(fake.binding)
    expect(source.getSnapshot().openState).toBe('error')
    expect(source.getSnapshot().openState).toBe('error')
    fake.setSnapshot(snapshot(fields, { pendingSubmissions: [{ requestId: 'pending-2' }], hasMore: true }))
    expect(source.getSnapshot().openState).toBe('error')
    expect(warnSpy()).toHaveBeenCalledTimes(1)
    expect(warnText()).toContain(LOG_PREFIX)
    expect(warnText()).toContain('not-a-state')
  })

  it('A3 returns the same source and actions for one binding and different ones for another', () => {
    const first = fakeBinding({ ...INITIAL, sessionId: 's1' })
    const second = fakeBinding({ ...INITIAL, sessionId: 's2' })
    const sessions = fakeSessions((id) => (id === 's2' ? second.binding : first.binding))
    expect(stateSourceOf(first.binding)).toBe(stateSourceOf(first.binding))
    expect(stateSourceOf(second.binding)).not.toBe(stateSourceOf(first.binding))

    const firstActions: WebuiSessionActions = sessionActionsOf(sessions, first.binding)
    expect(sessionActionsOf(sessions, first.binding)).toBe(firstActions)
    expect(sessionActionsOf(sessions, second.binding)).not.toBe(firstActions)
  })

  it('A4 send returns the host ok flag and passes text, queue, and the same signal', async () => {
    const fake = fakeBinding()
    const actions = actionsFor(fake, 's1', () => fake.binding)
    const controller = new AbortController()
    fake.prompt.mockResolvedValueOnce({ ok: true })
    await expect(actions.send('hello', controller.signal)).resolves.toBe(true)

    const call = fake.prompt.mock.calls[0]
    expect(call).toHaveLength(3)
    expect(call?.[0]).toEqual([{ type: 'text', text: 'hello' }])
    expect(call?.[1]).toBe('queue')
    expect(call?.[2]).toBe(controller.signal)

    fake.prompt.mockResolvedValueOnce({ ok: false })
    await expect(actions.send('hello', new AbortController().signal)).resolves.toBe(false)
  })

  it('A4 send returns false and warns once without the sent text when prompt throws or rejects', async () => {
    const text = 'secret-text-123'
    const syncFake = fakeBinding()
    const syncActions = actionsFor(syncFake, 's1', () => syncFake.binding)
    syncFake.prompt.mockImplementation(() => {
      throw new Error('sync-boom')
    })
    const syncResult = syncActions.send(text, new AbortController().signal)
    expect(syncResult).toBeInstanceOf(Promise)
    await expect(syncResult).resolves.toBe(false)
    expect(warnSpy()).toHaveBeenCalledTimes(1)
    expect(warnText()).toContain(LOG_PREFIX)
    expect(warnText()).not.toContain(text)

    warnSpy().mockClear()
    const asyncFake = fakeBinding()
    const asyncActions = actionsFor(asyncFake, 's1', () => asyncFake.binding)
    asyncFake.prompt.mockImplementation(() => Promise.reject(new Error('async-boom')))
    await expect(asyncActions.send(text, new AbortController().signal)).resolves.toBe(false)
    expect(warnSpy()).toHaveBeenCalledTimes(1)
    expect(warnText()).toContain(LOG_PREFIX)
    expect(warnText()).not.toContain(text)
  })

  it('A4 send returns false without calling prompt for blank text or a stale binding', async () => {
    const blank = fakeBinding()
    await expect(actionsFor(blank, 's1', () => blank.binding).send('   ', new AbortController().signal)).resolves.toBe(
      false,
    )
    expect(blank.prompt).not.toHaveBeenCalled()

    const replaced = fakeBinding()
    const other = fakeBinding()
    await expect(
      actionsFor(replaced, 's1', () => other.binding).send('hello', new AbortController().signal),
    ).resolves.toBe(false)
    expect(replaced.prompt).not.toHaveBeenCalled()
    expect(other.prompt).not.toHaveBeenCalled()

    const missing = fakeBinding()
    await expect(actionsFor(missing, 's1', () => undefined).send('hello', new AbortController().signal)).resolves.toBe(
      false,
    )
    expect(missing.prompt).not.toHaveBeenCalled()
  })

  it('A5 stop returns the host ok flag and calls cancel with no arguments', async () => {
    const fake = fakeBinding()
    const actions = actionsFor(fake, 's1', () => fake.binding)
    fake.cancel.mockResolvedValueOnce({ ok: true })
    await expect(actions.stop(new AbortController().signal)).resolves.toBe(true)
    expect(fake.cancel.mock.calls[0]).toEqual([])

    fake.cancel.mockResolvedValueOnce({ ok: false })
    await expect(actions.stop(new AbortController().signal)).resolves.toBe(false)
  })

  it('A5 stop returns false without throwing when cancel throws or rejects', async () => {
    const syncFake = fakeBinding()
    syncFake.cancel.mockImplementation(() => {
      throw new Error('sync-boom')
    })
    await expect(actionsFor(syncFake, 's1', () => syncFake.binding).stop(new AbortController().signal)).resolves.toBe(
      false,
    )
    expect(warnSpy()).toHaveBeenCalledTimes(1)
    expect(warnText()).toContain(LOG_PREFIX)

    warnSpy().mockClear()
    const asyncFake = fakeBinding()
    asyncFake.cancel.mockImplementation(() => Promise.reject(new Error('async-boom')))
    await expect(actionsFor(asyncFake, 's1', () => asyncFake.binding).stop(new AbortController().signal)).resolves.toBe(
      false,
    )
    expect(warnSpy()).toHaveBeenCalledTimes(1)
    expect(warnText()).toContain(LOG_PREFIX)
  })

  it('A5 stop returns false without calling cancel when the binding is stale', async () => {
    const replaced = fakeBinding()
    const other = fakeBinding()
    await expect(actionsFor(replaced, 's1', () => other.binding).stop(new AbortController().signal)).resolves.toBe(
      false,
    )
    expect(replaced.cancel).not.toHaveBeenCalled()
    expect(other.cancel).not.toHaveBeenCalled()

    const missing = fakeBinding()
    await expect(actionsFor(missing, 's1', () => undefined).stop(new AbortController().signal)).resolves.toBe(false)
    expect(missing.cancel).not.toHaveBeenCalled()
  })

  it('A6 returns false without calling the host when the signal is already aborted', async () => {
    const fake = fakeBinding()
    const actions = actionsFor(fake, 's1', () => fake.binding)
    const controller = new AbortController()
    controller.abort()
    await expect(actions.send('hello', controller.signal)).resolves.toBe(false)
    await expect(actions.stop(controller.signal)).resolves.toBe(false)
    expect(fake.prompt).not.toHaveBeenCalled()
    expect(fake.cancel).not.toHaveBeenCalled()
  })

  it('A6 settles false when the host never settles and the signal aborts', async () => {
    const fake = fakeBinding()
    const actions = actionsFor(fake, 's1', () => fake.binding)
    fake.prompt.mockImplementation(() => new Promise<HostAnswer>(() => {}))
    const sendController = new AbortController()
    const sending = actions.send('hello', sendController.signal)
    sendController.abort()
    await expect(sending).resolves.toBe(false)

    fake.cancel.mockImplementation(() => new Promise<HostAnswer>(() => {}))
    const stopController = new AbortController()
    const stopping = actions.stop(stopController.signal)
    stopController.abort()
    await expect(stopping).resolves.toBe(false)
  })

  it('A7 a second send does not abort or replace the first', async () => {
    const fake = fakeBinding()
    const actions = actionsFor(fake, 's1', () => fake.binding)
    const first = deferred<HostAnswer>()
    const second = deferred<HostAnswer>()
    fake.prompt.mockImplementationOnce(() => first.promise)
    fake.prompt.mockImplementationOnce(() => second.promise)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstSend = actions.send('one', firstController.signal)
    const secondSend = actions.send('two', secondController.signal)

    expect(fake.prompt).toHaveBeenCalledTimes(2)
    expect(firstController.signal.aborted).toBe(false)
    expect(fake.prompt.mock.calls[0]?.[0]).toEqual([{ type: 'text', text: 'one' }])
    expect(fake.prompt.mock.calls[0]?.[2]).toBe(firstController.signal)
    expect(fake.prompt.mock.calls[1]?.[0]).toEqual([{ type: 'text', text: 'two' }])
    expect(fake.prompt.mock.calls[1]?.[2]).toBe(secondController.signal)

    first.resolve({ ok: true })
    second.resolve({ ok: false })
    await expect(firstSend).resolves.toBe(true)
    await expect(secondSend).resolves.toBe(false)
  })

  it('A7 a second stop does not abort or replace the first', async () => {
    const fake = fakeBinding()
    const actions = actionsFor(fake, 's1', () => fake.binding)
    const first = deferred<HostAnswer>()
    const second = deferred<HostAnswer>()
    fake.cancel.mockImplementationOnce(() => first.promise)
    fake.cancel.mockImplementationOnce(() => second.promise)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const firstStop = actions.stop(firstController.signal)
    const secondStop = actions.stop(secondController.signal)

    expect(fake.cancel).toHaveBeenCalledTimes(2)
    expect(fake.cancel.mock.calls[0]).toEqual([])
    expect(fake.cancel.mock.calls[1]).toEqual([])
    expect(firstController.signal.aborted).toBe(false)

    first.resolve({ ok: true })
    second.resolve({ ok: false })
    await expect(firstStop).resolves.toBe(true)
    await expect(secondStop).resolves.toBe(false)
  })

  it('A8 injects the cached source and actions or throws when the binding is missing', () => {
    const fake = fakeBinding({ ...INITIAL, sessionId: 's1' })
    const sessions = fakeSessions((id) => (id === 's1' ? fake.binding : undefined))
    const inject = sessionInjectFor(sessions)
    const first: WebuiSessionInject = inject('s1')
    expect(Object.keys(first).sort()).toEqual(['hooks', 'webuiSessionActions'])
    expect(Object.keys(first.hooks)).toEqual(['webuiSession'])
    expect(first.hooks.webuiSession).toBe(stateSourceOf(fake.binding))
    expect(first.webuiSessionActions).toBe(sessionActionsOf(sessions, fake.binding))

    const second = inject('s1')
    expect(second.hooks.webuiSession).toBe(first.hooks.webuiSession)
    expect(second.webuiSessionActions).toBe(first.webuiSessionActions)

    const again = sessionInjectFor(sessions)('s1')
    expect(again.hooks.webuiSession).toBe(first.hooks.webuiSession)
    expect(again.webuiSessionActions).toBe(first.webuiSessionActions)

    let thrown: unknown
    try {
      sessionInjectFor(fakeSessions(() => undefined))('s1')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain('s1')
  })
})
