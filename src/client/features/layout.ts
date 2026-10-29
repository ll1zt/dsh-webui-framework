/** Layout feature: provides `webuiLayout`, through which other plugins register blocks and presets. */
import type { Context } from '@deepseek-ai/cordis'
import { BlockRegistry, WebuiLayout } from '../services/block-registry.ts'
import type { WebuiFeature } from './index.ts'

/**
 * Create the registry and expose it as `ctx.webuiLayout`; the service leaves with this plugin's fiber.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  new WebuiLayout(ctx, new BlockRegistry())
}

export const layout: WebuiFeature = { name: 'layout', inject: ['slots'], apply }
