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
 * page registry, so the dock draws what `webuiLayout` registers, and a failed block can be retried.
 * The seat is registered before this feature returns, so the two block lists are declared by the time
 * anything else can look at the slots.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  const { registry, controller, errors } = dockOf(ctx)
  ctx.effect(() => ctx.locale.register('webui', { zh, en }), 'webui: dictionaries')
  ctx.effect(
    () => ctx.slots.onEntryError((key, registration, error, info) => errors.record(key, registration, error, info)),
    'webui: entry errors',
  )
  ctx.effect(
    () => registry.subscribe(() => errors.retain(new Set(registry.blocks().map((block) => block.meta.id)))),
    'webui: forget unregistered failures',
  )
  // Registered outside an effect callback: the root seat declares the two block lists the moment this feature
  // applies, so no contributor holding `webuiLayout` can register a block ahead of the children table.
  const unregister = ctx.slots.register(
    {
      name: 'root',
      locale: 'webui',
      inject: (): AppInject => ({
        hooks: { dock: controller, locale: ctx.locale, errors },
        dockActions: controller.actions,
        layoutView: controller.view,
        retryBlock: (blockId: string): void => {
          if (registry.remount(blockId)) errors.clear(blockId)
        },
      }),
      children: {
        [WEBUI_SLOT_KEYS.root]: { kind: 'list', scope: 'root' },
        [WEBUI_SLOT_KEYS.session]: { kind: 'list', scope: 'session' },
      },
    },
    App,
  )
  ctx.effect(() => unregister, 'webui: root')
}

export const shell: WebuiFeature = { name: 'shell', inject: ['slots', 'locale'], apply }
