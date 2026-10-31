/** Shell feature: owns the `webui` copy namespace and takes the `root` seat, declaring the block lists as its children. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import en from '../../../locale/en.json'
import zh from '../../../locale/zh.json'
import { App, type AppInject } from '../entries/App.tsx'
import { dockOf } from '../services/dock-state.ts'
import { WEBUI_SLOT_KEYS } from '../types.ts'
import type { WebuiFeature } from './index.ts'

/**
 * Register the dictionaries, then take the `root` seat. No `priority`: the registration
 * keeps the shipped slot's fail-loud contract. The seat's inject face hands App the controller over the
 * page registry, so the dock draws what `webuiLayout` registers.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  const { controller } = dockOf(ctx)
  ctx.effect(() => ctx.locale.register('webui', { zh, en }), 'webui: dictionaries')
  ctx.effect(
    () =>
      ctx.slots.register(
        {
          name: 'root',
          locale: 'webui',
          inject: (): AppInject => ({
            hooks: { dock: controller, locale: ctx.locale },
            dockActions: controller.actions,
          }),
          children: {
            [WEBUI_SLOT_KEYS.root]: { kind: 'list', scope: 'root' },
            [WEBUI_SLOT_KEYS.session]: { kind: 'list', scope: 'session' },
          },
        },
        App,
      ),
    'webui: root',
  )
}

export const shell: WebuiFeature = { name: 'shell', inject: ['slots', 'locale'], apply }
