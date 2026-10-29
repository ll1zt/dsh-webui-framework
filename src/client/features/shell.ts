/** Shell feature: owns the `webui` copy namespace and takes the `root` seat, declaring the block lists as its children. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import en from '../../../locale/en.json'
import zh from '../../../locale/zh.json'
import { App } from '../entries/App.tsx'
import { WEBUI_SLOT_KEYS } from '../types.ts'
import type { WebuiFeature } from './index.ts'

/**
 * Register the dictionaries, then take the `root` seat. No `priority`: the registration
 * keeps the shipped slot's fail-loud contract.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('webui', { zh, en }), 'webui: dictionaries')
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: 'root',
          locale: 'webui',
          children: {
            [WEBUI_SLOT_KEYS.root]: { kind: 'list', scope: 'root' },
            [WEBUI_SLOT_KEYS.session]: { kind: 'list', scope: 'session' },
          },
        },
        // App does not render the lists yet, which the children check rejects at compile time; the cast goes once App consumes renderSlot.
        App as never,
      ),
    'webui: root',
  )
}

export const shell: WebuiFeature = { name: 'shell', inject: ['slots', 'locale'], apply }
