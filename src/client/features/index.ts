/** Feature list of the browser half: the single place a new feature is added. */
import type { Context } from '@deepseek-ai/cordis'
import { layout } from './layout.ts'
import { shell } from './shell.ts'
import { theme } from './theme.ts'

/**
 * One independently activated slice of the client. `inject` names only the services this feature uses, so a
 * missing service deactivates this feature alone and the rest of the page keeps working.
 */
export interface WebuiFeature {
  /** Unique, human-readable id (shown in logs and in the fake context's `activePlugins`). */
  name: string
  /** Services the feature needs before `apply` runs. */
  inject: readonly string[]
  /** Feature body, run once its services are available. */
  apply(ctx: Context): void
}

export const FEATURES: readonly WebuiFeature[] = [shell, theme, layout]
