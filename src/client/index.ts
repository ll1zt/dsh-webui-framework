/** Browser half: registers the plugin's services and slot entries (docs/03 §2). */
import '../styles/tokens.css'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import en from '../../locale/en.json'
import zh from '../../locale/zh.json'
import { App } from './entries/App.tsx'
import { createPageStore } from './services/page-store.ts'
import type {} from './types.ts'

export const name = 'dsh-web-ui'

/** Services the page cannot render a frame without (docs/03 §2.1). */
export const inject: string[] = ['slots', 'sessions', 'uiSession', 'workspaces', 'remote', 'theme', 'locale']

/**
 * Client plugin body: own the `webui` copy namespace, then take the `root` seat
 * with the page store. No `priority`: the registration keeps the shipped slot's
 * fail-loud contract.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  const pageStore = createPageStore()
  ctx.effect(() => ctx.locale.register('webui', { zh, en }), 'webui: dictionaries')
  ctx.effect(() => ctx.slots.register({ name: 'root', locale: 'webui', store: pageStore }, App), 'webui: root')
}
