/** Layout feature: provides `webuiLayout`, through which other plugins register blocks and presets. */
import type { Context } from '@deepseek-ai/cordis'
import { WebuiLayout } from '../services/block-registry.ts'
import { dockOf } from '../services/dock-state.ts'
import type { WebuiFeature } from './index.ts'

/**
 * Expose the page registry as `ctx.webuiLayout`; the service leaves with this plugin's fiber.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  new WebuiLayout(ctx, dockOf(ctx).registry)
}

export const layout: WebuiFeature = { name: 'layout', inject: ['slots'], apply }
