/** Shell feature: owns the `webui` copy namespace and takes the `root` seat. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import en from '../../../locale/en.json'
import zh from '../../../locale/zh.json'
import { App } from '../entries/App.tsx'
import { createPageStore } from '../services/page-store.ts'
import type {} from '../types.ts'
import type { WebuiFeature } from './index.ts'

/**
 * Register the dictionaries, then take the `root` seat with the page store. No `priority`: the registration
 * keeps the shipped slot's fail-loud contract.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  const pageStore = createPageStore()
  ctx.effect(() => ctx.locale.register('webui', { zh, en }), 'webui: dictionaries')
  ctx.effect(() => ctx.slots.register({ name: 'root', locale: 'webui', store: pageStore }, App), 'webui: root')
}

export const shell: WebuiFeature = { name: 'shell', inject: ['slots', 'locale'], apply }
