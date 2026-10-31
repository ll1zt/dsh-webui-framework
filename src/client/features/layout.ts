/** Layout feature: provides `webuiLayout`, through which other plugins register blocks and presets, and keeps the layout in the profile. */
import type { Context } from '@deepseek-ai/cordis'
import { WebuiLayout } from '../services/block-registry.ts'
import { dockOf } from '../services/dock-state.ts'
import { LAYOUT_NAMESPACE, LayoutPersistence, type LayoutConfigForm } from '../services/layout-persistence.ts'
import { LOG_PREFIX } from '../services/log-prefix.ts'
import type { WebuiFeature } from './index.ts'

// Both services are optional and belong to other host plugins, so only the part used here is declared.
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host settings forms (`@deepseek-ai/dsh-client-ui-settings`), one per profile namespace. */
    configForms: { get(namespace: string): LayoutConfigForm }
    /** The host plugin loader; its `await` settles once the loader has no entry left to start. */
    loader: { await(): Promise<void> }
  }
}

/**
 * Expose the page registry as `ctx.webuiLayout`; the service leaves with this plugin's fiber.
 * `configForms` and `loader` are optional: each is waited for with `ctx.inject`, never listed in the
 * feature's `inject`, so the page starts without them and the layout then stays in memory.
 * @param ctx - client root context.
 */
function apply(ctx: Context): void {
  const { registry, controller } = dockOf(ctx)
  new WebuiLayout(ctx, registry)

  ctx.inject(['configForms'], (ctx) => {
    ctx.effect(
      () => new LayoutPersistence(controller, ctx.configForms.get(LAYOUT_NAMESPACE)).start(),
      'webui: layout persistence',
    )
  })

  // "The loader has finished" is `ctx.loader.await()`: the host boot waits for the same promise
  // (ref/deepseek-harness/packages/client/web/src/boot-client.ts:55), and `EntryTree.await` loops until no
  // init or lifecycle task is left (ref/deepseek-harness/vendor/loader/src/config/tree.ts:44). It is started from
  // the inject callback and never awaited in `apply`: that would wait for this plugin's own inertia.
  ctx.inject(['loader'], (ctx) => {
    ctx.effect(() => {
      let live = true
      ctx.loader.await().then(
        () => {
          if (live) controller.settle()
        },
        (error: unknown) => console.warn(`${LOG_PREFIX} the loader did not finish: ${String(error)}`),
      )
      return () => {
        live = false
      }
    }, 'webui: layout settle')
  })
}

export const layout: WebuiFeature = { name: 'layout', inject: ['slots'], apply }
