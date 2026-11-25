/** Browser half: assembles the feature plugins; each feature declares its own services. */
import '../styles/tokens.css'
import type { Context } from '@deepseek-ai/cordis'
import { FEATURES } from './features/index.ts'
import { createDock } from './services/dock-state.ts'

export const name = 'webui-framework'

/**
 * Client plugin body: create one dock for the page and load every feature as its own sub-plugin, so one
 * lacking a service stays inactive alone while the active ones share the dock.
 */
export function apply(ctx: Context): void {
  const dock = createDock()
  for (const feature of FEATURES) {
    ctx.plugin({ name: feature.name, inject: feature.inject, apply: (sub: Context) => feature.apply(sub, dock) })
  }
}
