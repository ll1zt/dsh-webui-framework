/** Browser half: assembles the feature plugins; each feature declares its own services. */
import '../styles/tokens.css'
import type { Context } from '@deepseek-ai/cordis'
import { FEATURES } from './features/index.ts'

export const name = 'dsh-web-ui'

/**
 * Client plugin body: load every feature as its own sub-plugin, so one lacking a service stays inactive alone.
 */
export function apply(ctx: Context): void {
  for (const feature of FEATURES) ctx.plugin(feature)
}
