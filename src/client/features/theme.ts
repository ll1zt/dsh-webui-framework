/** Theme feature: applies the active theme to the page and follows `theme/change`. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { ThemePresenter } from '../services/theme-presenter.ts'
import type { WebuiFeature } from './index.ts'

/**
 * Apply the current theme immediately, then re-apply on every change; teardown retracts the presenter's writes.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  // One presenter per plugin fiber: it retracts only its own writes, so disposing it on teardown leaves no theme residue.
  const presenter = new ThemePresenter()
  ctx.effect(() => {
    presenter.apply(ctx.theme.getTheme())
    return () => presenter.dispose()
  }, 'webui: theme')
  ctx.effect(() => ctx.on('theme/change', (snapshot) => presenter.apply(snapshot)), 'webui: theme change')
}

export const theme: WebuiFeature = { name: 'theme', inject: ['theme'], apply }
