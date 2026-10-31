/** The one registry and controller of a page, shared by the layout feature and the shell feature. */
import type { Context } from '@deepseek-ai/cordis'
import { BlockRegistry } from './block-registry.ts'
import { EntryErrorTracker } from './entry-errors.ts'
import { LayoutController } from './layout-controller.ts'

interface Dock {
  registry: BlockRegistry
  controller: LayoutController
  errors: EntryErrorTracker
}

const docks = new WeakMap<object, Dock>()

/**
 * The page's registry and the controller over it. Features load as separate plugins, so they meet
 * here, keyed by the root context, instead of through a service the shell would have to wait for.
 * @param ctx - any context of the page.
 * @returns the dock, created on first use.
 */
export function dockOf(ctx: Context): Dock {
  let dock = docks.get(ctx.root)
  if (dock === undefined) {
    const registry = new BlockRegistry()
    dock = { registry, controller: new LayoutController(registry), errors: new EntryErrorTracker() }
    docks.set(ctx.root, dock)
  }
  return dock
}
