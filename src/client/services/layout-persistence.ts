/** Keeps the layout in the user's profile: reads the saved one once it is there, writes after each user action. */
import type { WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import type { LayoutController } from './layout-controller.ts'
import { LOG_PREFIX } from './log-prefix.ts'

/** The profile namespace of the layout: the loader row id of this plugin. */
export const LAYOUT_NAMESPACE = 'webui-framework'

/** The part of a settings form the layout needs; the host's `ConfigForm` fits it. */
export interface LayoutConfigForm {
  getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: { layout?: unknown } | undefined }
  subscribe(listener: () => void): () => void
  set(path: string, value: unknown): Promise<boolean>
}

/** Moves the layout between a controller and its profile form. */
export class LayoutPersistence {
  readonly #controller: LayoutController
  readonly #form: LayoutConfigForm

  constructor(controller: LayoutController, form: LayoutConfigForm) {
    this.#controller = controller
    this.#form = form
  }

  /**
   * Start reading and writing.
   * @returns the disposer that stops both.
   */
  start(): () => void {
    let applied = false
    let acted = false
    const read = (): void => {
      const snapshot = this.#form.getSnapshot()
      if (applied || snapshot.status !== 'ready') return
      applied = true
      const saved = snapshot.value?.layout
      if (!acted && saved !== undefined) this.#controller.replaceLayout(saved, this.#controller.settled)
    }
    const unsubscribe = this.#form.subscribe(read)
    const unlisten = this.#controller.onAction((layout) => {
      acted = true
      this.#write(layout)
    })
    read()
    return () => {
      unsubscribe()
      unlisten()
    }
  }

  /** One failed write is only a console line: the user keeps the layout they see (D59). */
  #write(layout: WebuiLayout): void {
    const failed = (reason: unknown): void => console.warn(`${LOG_PREFIX} layout was not saved: ${describe(reason)}`)
    try {
      this.#form.set('layout', layout).then((accepted) => {
        if (!accepted) failed('the profile refused the write')
      }, failed)
    } catch (error) {
      failed(error)
    }
  }
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
