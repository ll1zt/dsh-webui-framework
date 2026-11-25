/** Layout feature: provides `webuiLayout`, through which other plugins register blocks and presets, and keeps the layout in the profile. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { slotDeclarationsOf, WebuiLayout, type BlockRegistry } from '../services/block-registry.ts'
import type { Dock } from '../services/dock-state.ts'
import { LAYOUT_NAMESPACE, LayoutPersistence } from '../services/layout-persistence.ts'
import { LOG_PREFIX } from '../services/log-prefix.ts'
import { WEBUI_SLOT_KEYS } from '../types.ts'
import type { WebuiFeature } from './index.ts'

// `loader` belongs to a host plugin and is optional, so only the part used here is declared. The type of `configForms` comes from the
// `@deepseek-ai/dsh-client-ui-settings/client` import above (installed transitively through dsh-web-app).
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host plugin loader; its `await` settles once the loader has no entry left to start. */
    loader: { await(): Promise<void> }
  }
}

/**
 * Expose the page registry as `ctx.webuiLayout` once the root block slot is declared: a contributor that
 * receives the service earlier registers its blocks into a slot the host has not published yet. The service
 * leaves with this plugin's fiber.
 * @param ctx - client root context.
 * @param registry - the page registry the service forwards to.
 */
function provideLayout(ctx: Context, registry: BlockRegistry): void {
  const declarations = slotDeclarationsOf(ctx.slots)
  const slotKey = WEBUI_SLOT_KEYS.root
  if (declarations.declared(slotKey)) {
    new WebuiLayout(ctx, registry)
    return
  }
  ctx.effect(() => {
    let live = true
    const stopWaiting = declarations.onDeclared(slotKey, () => {
      if (!live || !declarations.declared(slotKey)) return
      live = false
      new WebuiLayout(ctx, registry)
    })
    return () => {
      live = false
      stopWaiting()
    }
  }, 'webui: webuiLayout')
}

/**
 * Provide `webuiLayout` once the block slots exist; `configForms` and `loader` are optional: each is waited for
 * with `ctx.inject`, never listed in the feature's `inject`, so the page starts without them and the layout then
 * stays in memory.
 * @param ctx - client root context.
 * @param dock - shared dock for this page.
 */
function apply(ctx: Context, dock: Dock): void {
  const { registry, controller } = dock
  provideLayout(ctx, registry)

  ctx.inject(['configForms'], (ctx) => {
    ctx.effect(
      () => new LayoutPersistence(controller, ctx.configForms.get<{ layout?: unknown }>(LAYOUT_NAMESPACE)).start(),
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
