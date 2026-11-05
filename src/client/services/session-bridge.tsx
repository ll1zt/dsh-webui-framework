/**
 * Wraps a session block so it receives the contract `session` object.
 * Created once per registration, never during render. The in-flight `send` / `stop` of a mount are cancelled
 * when that mount ends: the main session changing and the block unregistering are both unmounts of this wrapper.
 */
import { createElement, useEffect, useMemo, useRef, type ComponentType, type FunctionComponent } from 'react'
import type { BlockInstanceProps, SessionBlockProps, WebuiSession } from '@lllzt/dsh-webui-framework/contract'
import type { WebuiSessionActions } from './session-adapter.ts'

/** The state hook the host binds from the injected `webuiSession` source. */
export type WebuiSessionStateHook = WebuiSession['useState']

/**
 * Props the host passes to the wrapper: the six block props, the session id, the bound state hook and the actions.
 * Host standard props (`useSession`, `useProjection`, `useAccess`) may also arrive at runtime and are not forwarded.
 */
export interface SessionBridgeProps extends BlockInstanceProps {
  sessionId: string
  useWebuiSession: WebuiSessionStateHook
  webuiSessionActions: WebuiSessionActions
}

/**
 * Wrap `component` so it renders with `props.session` instead of the host's session face.
 * The `AbortController` lives in a mount effect, not in the memo: React 18 StrictMode replays effects, and a
 * controller created in `useMemo` would already be aborted on the second mount.
 * @param component - the contributor's session block, function or class.
 * @returns a function component for the session slot.
 */
export function bridgeSessionBlock(component: ComponentType<SessionBlockProps>): FunctionComponent<SessionBridgeProps> {
  const SessionBridge: FunctionComponent<SessionBridgeProps> = ({
    blockId,
    contentId,
    active,
    layout,
    tab,
    view,
    sessionId,
    useWebuiSession,
    webuiSessionActions,
  }) => {
    const controller = useRef<AbortController | null>(null)
    useEffect(() => {
      const next = new AbortController()
      controller.current = next
      return () => {
        next.abort()
        controller.current = null
      }
    }, [])
    // Send and stop read the ref when they are called, so a replayed effect's new controller is the one they use.
    const session = useMemo<WebuiSession>(
      () => ({
        sessionId,
        useState: useWebuiSession,
        send: (text) => {
          const signal = controller.current?.signal
          if (signal === undefined) return Promise.resolve(false)
          return webuiSessionActions.send(text, signal)
        },
        stop: () => {
          const signal = controller.current?.signal
          if (signal === undefined) return Promise.resolve(false)
          return webuiSessionActions.stop(signal)
        },
      }),
      [sessionId, useWebuiSession, webuiSessionActions],
    )
    return createElement(component, { blockId, contentId, active, layout, tab, view, session })
  }
  return SessionBridge
}
