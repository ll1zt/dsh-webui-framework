/**
 * The one module that knows the host session shape. It borrows `sessions.binding` for a session entry's
 * inject and never retains a session: state sources and actions are cached per binding, and `subscribe`
 * is forwarded only while a consumer is listening.
 */
import type { ISessions, SessionBinding, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  SessionActionRejection,
  SessionActionResult,
  WebuiSessionState,
} from '@lllzt/dsh-webui-framework/contract'
import { LOG_PREFIX } from './log-prefix.ts'

/** The host's session id, derived here so this module does not import the brand itself. */
type HostSessionId = Parameters<ISessions['binding']>[0]

interface HostResult {
  readonly ok: boolean
}

const KNOWN_OPEN_STATES: ReadonlySet<string> = new Set(['cold', 'loading', 'open', 'error'])

const stateSources = new WeakMap<SessionBinding, HostObservable<WebuiSessionState>>()
const actionsByBinding = new WeakMap<SessionBinding, WebuiSessionActions>()

function isKnownOpenState(value: string): value is WebuiSessionState['openState'] {
  return KNOWN_OPEN_STATES.has(value)
}

/** The brand is compile-time only; the host's `binding` still demands its own id type. */
function hostSessionId(sessionId: string): HostSessionId {
  return sessionId as HostSessionId
}

function sameState(left: WebuiSessionState, right: WebuiSessionState): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.running === right.running &&
    left.blank === right.blank &&
    left.removed === right.removed &&
    left.openState === right.openState &&
    left.lastAgentError === right.lastAgentError
  )
}

/** `sessions.binding` returns the borrowed object only while that generation is still held. */
function isCurrent(sessions: ISessions, binding: SessionBinding): boolean {
  return sessions.binding(binding.session.getSnapshot().sessionId) === binding
}

/** Host failures are logged without the text the user sent. */
function warnHostFailure(op: 'prompt' | 'cancel', error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  console.warn(`${LOG_PREFIX} session ${op} failed: ${detail}`)
}

function accepted(): SessionActionResult {
  return { ok: true }
}

function rejected(reason: SessionActionRejection): SessionActionResult {
  return { ok: false, reason }
}

/**
 * Settle `pending` as `unmounted` when `signal` aborts first. A rejection is logged once and becomes
 * `host-refused`; the returned promise does not reject. Aborting here does not abort any other in-flight call.
 * @param signal - cancellation for this call only.
 * @param pending - the host promise.
 * @param op - which host call failed, when it fails.
 * @returns `{ ok: true }` when the host accepted before cancellation, otherwise the rejection.
 */
function racedOk(
  signal: AbortSignal,
  pending: Promise<HostResult>,
  op: 'prompt' | 'cancel',
): Promise<SessionActionResult> {
  const captured = pending.then(
    (result) => (result.ok === true ? accepted() : rejected('host-refused')),
    (error: unknown) => {
      warnHostFailure(op, error)
      return rejected('host-refused')
    },
  )
  if (signal.aborted) return Promise.resolve(rejected('unmounted'))
  let onAbort: () => void = () => {}
  const aborted = new Promise<SessionActionResult>((resolve) => {
    onAbort = (): void => resolve(rejected('unmounted'))
    signal.addEventListener('abort', onAbort, { once: true })
  })
  return Promise.race([captured, aborted]).finally(() => {
    signal.removeEventListener('abort', onAbort)
  })
}

/**
 * Copy the six contract fields out of a host snapshot. An `openState` the contract does not name becomes `'error'`.
 * @param snapshot - host session snapshot.
 * @returns the contract state.
 */
export function toWebuiSessionState(snapshot: SessionSnapshot): WebuiSessionState {
  const openState: string = snapshot.openState
  return {
    sessionId: snapshot.sessionId,
    running: snapshot.running,
    blank: snapshot.blank,
    removed: snapshot.removed,
    openState: isKnownOpenState(openState) ? openState : 'error',
    lastAgentError: snapshot.lastAgentError,
  }
}

/**
 * The contract state source for `binding`, cached for as long as the binding object lives.
 * `getSnapshot` keeps returning the previous object while the six fields are equal, even when the host
 * hands out a new snapshot because some other field changed. Nothing subscribes until `subscribe` is called.
 * An open state outside the four contract values is reported once for this source.
 * @param binding - borrowed host binding.
 * @returns the stable observable.
 */
export function stateSourceOf(binding: SessionBinding): HostObservable<WebuiSessionState> {
  const existing = stateSources.get(binding)
  if (existing !== undefined) return existing
  const session = binding.session
  let lastSnapshot: SessionSnapshot | undefined
  let lastState: WebuiSessionState | undefined
  let warnedUnknownOpenState = false
  const source: HostObservable<WebuiSessionState> = {
    getSnapshot() {
      const snapshot = session.getSnapshot()
      if (snapshot === lastSnapshot && lastState !== undefined) return lastState
      const openState: string = snapshot.openState
      if (!warnedUnknownOpenState && !isKnownOpenState(openState)) {
        warnedUnknownOpenState = true
        console.warn(`${LOG_PREFIX} unknown session openState "${openState}"; reporting it as "error"`)
      }
      const next = toWebuiSessionState(snapshot)
      lastSnapshot = snapshot
      if (lastState === undefined || !sameState(lastState, next)) lastState = next
      return lastState
    },
    subscribe(listener) {
      return session.subscribe(listener)
    },
  }
  stateSources.set(binding, source)
  return source
}

/**
 * Send and stop for one borrowed binding. Both promises settle a `SessionActionResult` instead of rejecting:
 * blank text, a stale binding, an aborted signal, or the host refusing or throwing. A later call does not abort an
 * earlier one — `queue` appends a turn, and cancelling the previous send would drop that message.
 */
export interface WebuiSessionActions {
  /**
   * Send `text` on this binding.
   * @param text - message text.
   * @param signal - cancellation for this call only.
   * @returns `{ ok: true }` when the host accepted it, otherwise the reason. Never rejects.
   */
  send(text: string, signal: AbortSignal): Promise<SessionActionResult>
  /**
   * Stop the running turn.
   * @param signal - cancellation for this call only. The host `cancel` takes no signal; losing the race still settles `unmounted`.
   * @returns `{ ok: true }` when the host accepted it, otherwise the reason. Never rejects.
   */
  stop(signal: AbortSignal): Promise<SessionActionResult>
}

/**
 * Actions for `binding`, cached by that binding. `send` returns `blank-text` without calling the host when `text`
 * is blank. Both return `no-session` when the binding is no longer the one `sessions.binding` returns, and
 * `unmounted` when `signal` is already aborted. A host `{ ok: false }` or a throw is `host-refused`.
 * @param sessions - host session service, read only to re-check the borrowed binding.
 * @param binding - borrowed host binding.
 * @returns the stable actions.
 */
export function sessionActionsOf(sessions: ISessions, binding: SessionBinding): WebuiSessionActions {
  const existing = actionsByBinding.get(binding)
  if (existing !== undefined) return existing
  const actions: WebuiSessionActions = {
    async send(text, signal) {
      try {
        if (text.trim() === '') return rejected('blank-text')
        if (!isCurrent(sessions, binding)) return rejected('no-session')
        if (signal.aborted) return rejected('unmounted')
        return await racedOk(signal, binding.session.prompt([{ type: 'text', text }], 'queue', signal), 'prompt')
      } catch (error) {
        warnHostFailure('prompt', error)
        return rejected('host-refused')
      }
    },
    async stop(signal) {
      try {
        if (!isCurrent(sessions, binding)) return rejected('no-session')
        if (signal.aborted) return rejected('unmounted')
        return await racedOk(signal, binding.session.cancel(), 'cancel')
      } catch (error) {
        warnHostFailure('cancel', error)
        return rejected('host-refused')
      }
    },
  }
  actionsByBinding.set(binding, actions)
  return actions
}

/** What a session entry injects: the state source under `hooks`, and the actions beside it. */
export interface WebuiSessionInject {
  hooks: { webuiSession: HostObservable<WebuiSessionState> }
  webuiSessionActions: WebuiSessionActions
}

/**
 * Build the inject callback for session entries.
 * @param sessions - host session service.
 * @returns a function of a session id string. It throws when that id has no borrowed binding, and the
 * message includes the id. The same binding yields the same state source and the same actions.
 */
export function sessionInjectFor(sessions: ISessions): (sessionId: string) => WebuiSessionInject {
  return (sessionId) => {
    const binding = sessions.binding(hostSessionId(sessionId))
    if (binding === undefined) throw new Error(`no session binding for ${sessionId}`)
    return {
      hooks: { webuiSession: stateSourceOf(binding) },
      webuiSessionActions: sessionActionsOf(sessions, binding),
    }
  }
}
