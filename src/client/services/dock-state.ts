/** The one registry, controller, and error tracker of a page, shared across its client features. */
import { BlockRegistry } from './block-registry.ts'
import { EntryErrorTracker } from './entry-errors.ts'
import { LayoutController } from './layout-controller.ts'

/** Per-page dock state created at the client entry and handed to each feature sub-plugin. */
export interface Dock {
  registry: BlockRegistry
  controller: LayoutController
  errors: EntryErrorTracker
}

/**
 * Create a fresh, isolated dock for one page. Features load as separate sub-plugins and meet here
 * through the instance passed by the client entry instead of through a service the shell would have
 * to wait for.
 * @returns a new dock with its own registry, layout controller, and error tracker.
 */
export function createDock(): Dock {
  const registry = new BlockRegistry()
  return { registry, controller: new LayoutController(registry), errors: new EntryErrorTracker() }
}
