/** Tracks which blocks the host retired after a render error, so the dock can draw an error card in their cell. */
import { WEBUI_SLOT_KEYS } from '../types.ts'

/** A block whose slot entry threw while rendering. */
export interface BlockFailure {
  blockId: string
  error: Error
}

const BLOCK_SLOT_KEYS: ReadonlySet<string> = new Set(Object.values(WEBUI_SLOT_KEYS))

/** The id the host stored with a registration; a Factory definition has no `options` and so no id. */
function registrationId(registration: object): unknown {
  const { options } = registration as { options?: { id?: unknown } }
  return options?.id
}

/** Holds the failed blocks as an observable snapshot; the map is replaced, never mutated, on every change. */
export class EntryErrorTracker {
  #failures: ReadonlyMap<string, BlockFailure> = new Map()
  readonly #listeners = new Set<() => void>()

  /** @returns the failure recorded for `blockId`, if any. */
  failed(blockId: string): BlockFailure | undefined {
    return this.#failures.get(blockId)
  }

  /** @returns every recorded failure by block id; the same reference until something changes. */
  getSnapshot(): ReadonlyMap<string, BlockFailure> {
    return this.#failures
  }

  /**
   * Listen for changes.
   * @param listener - called after every change.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Take one `ctx.slots.onEntryError` report. Only an abdicated entry of a block slot with an id counts.
   * @param key - slot key of the failed entry.
   * @param registration - the failed registration; its `options.id`, when it has one, names the block.
   * @param error - the thrown value.
   * @param info - whether the host retired the entry from its cell.
   */
  record(key: string, registration: object, error: unknown, info: { abdicated: boolean }): void {
    const blockId = registrationId(registration)
    if (!BLOCK_SLOT_KEYS.has(key) || !info.abdicated || typeof blockId !== 'string' || blockId === '') return
    this.#replace(
      new Map(this.#failures).set(blockId, {
        blockId,
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    )
  }

  /**
   * Forget the failure of a block, for instance after a retry.
   * @param blockId - block id.
   */
  clear(blockId: string): void {
    if (!this.#failures.has(blockId)) return
    const next = new Map(this.#failures)
    next.delete(blockId)
    this.#replace(next)
  }

  /**
   * Forget the failures of blocks that left the registry. Notifies once when something was dropped, not at all otherwise.
   * @param blockIds - ids of the blocks still registered.
   */
  retain(blockIds: ReadonlySet<string>): void {
    const next = new Map(this.#failures)
    for (const blockId of next.keys()) if (!blockIds.has(blockId)) next.delete(blockId)
    if (next.size === this.#failures.size) return
    this.#replace(next)
  }

  #replace(next: ReadonlyMap<string, BlockFailure>): void {
    this.#failures = next
    for (const listener of [...this.#listeners]) listener()
  }
}
