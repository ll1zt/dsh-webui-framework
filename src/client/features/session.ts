/** Session feature: gives the page registry the session inject while the host `sessions` service is present. */
import type { Context } from '@deepseek-ai/cordis'
import { dockOf } from '../services/dock-state.ts'
import { sessionInjectFor } from '../services/session-adapter.ts'
import type { WebuiFeature } from './index.ts'

/**
 * Install the inject factory for session blocks, and clear it when this feature's fiber stops.
 * Without `sessions` the feature never applies, so a session block's own inject throws and only that entry shows an error.
 * @param ctx - client root context. `ctx.sessions` is typed by the augmentation `session-adapter` brings in.
 */
function apply(ctx: Context): void {
  const { registry } = dockOf(ctx)
  ctx.effect(() => {
    registry.setSessionInject(sessionInjectFor(ctx.sessions))
    return () => {
      registry.setSessionInject(undefined)
    }
  }, 'webui: session')
}

export const session: WebuiFeature = { name: 'session', inject: ['sessions'], apply }
