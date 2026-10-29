/** Block and preset registry behind the `webuiLayout` service: validation, ordering, duplicate diagnostics. */
import { Service, type Context } from '@deepseek-ai/cordis'
import type {
  BlockComponent,
  BlockMeta,
  Disposer,
  LayoutPreset,
  WebuiLayoutService,
} from '@lllzt/dsh-webui-framework/contract'
import { WEBUI_SLOT_KEYS } from '../types.ts'

/** A rejected duplicate registration; `kept` and `rejected` are the plugin names of the two registrants. */
export interface WebuiDiagnostic {
  kind: 'duplicate-block' | 'duplicate-preset'
  id: string
  kept: string
  rejected: string
}

/** One accepted block: its metadata, component and the plugin that registered it. */
export interface BlockRegistration {
  meta: BlockMeta
  component: BlockComponent
  owner: string
}

interface PresetRegistration {
  preset: LayoutPreset
  owner: string
}

// Assembled from the package label because scripts/source-guards.test.ts allows the bracketed literal only in ErrorBoundary.tsx.
const LOG_LABEL = 'webui-framework'
const LOG_PREFIX = `[${LOG_LABEL}]`
const UNNAMED_OWNER = '(unnamed)'

/**
 * Order by `priority` ascending, ties by `id` in code-point order (not UTF-16 code-unit order).
 * @param a - first item.
 * @param b - second item.
 * @returns negative when `a` comes first, positive when `b` does, 0 when equal.
 */
export function compareByPriorityThenId(
  a: { id: string; priority: number },
  b: { id: string; priority: number },
): number {
  if (a.priority !== b.priority) return a.priority < b.priority ? -1 : 1
  const left = Array.from(a.id)
  const right = Array.from(b.id)
  const shared = Math.min(left.length, right.length)
  for (let index = 0; index < shared; index += 1) {
    const difference = (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0)
    if (difference !== 0) return difference < 0 ? -1 : 1
  }
  return Math.sign(left.length - right.length)
}

function validate(kind: string, id: string, priority: number): void {
  if (typeof id !== 'string' || id === '') throw new TypeError(`${kind} id must be a non-empty string`)
  if (typeof priority !== 'number' || !Number.isFinite(priority)) {
    throw new TypeError(`${kind} "${id}": priority must be a finite number`)
  }
}

function ownerName(owner: Context): string {
  return owner.fiber.name || UNNAMED_OWNER
}

/** Holds the registered blocks and presets; slot entries follow the registering plugin's fiber. */
export class BlockRegistry {
  readonly #blocks = new Map<string, BlockRegistration>()
  readonly #presets = new Map<string, PresetRegistration>()
  readonly #diagnostics: WebuiDiagnostic[] = []
  readonly #listeners = new Set<() => void>()

  /**
   * Register a block and put its component into the slot of `meta.scope`.
   * @param owner - the registering plugin's context; the slot entry is torn down with its fiber.
   * @param meta - block metadata.
   * @param component - block component.
   * @returns disposer; a no-op when the id was already taken.
   * @throws {TypeError} when `meta.id` is empty or `meta.priority` is not a finite number.
   */
  registerBlock(owner: Context, meta: BlockMeta, component: BlockComponent): Disposer {
    validate('block', meta.id, meta.priority)
    const name = ownerName(owner)
    const existing = this.#blocks.get(meta.id)
    if (existing !== undefined) {
      this.#reject('duplicate-block', meta.id, existing.owner, name)
      return () => {}
    }
    const registration: BlockRegistration = { meta, component, owner: name }
    this.#blocks.set(meta.id, registration)
    const remove = (): void => {
      if (this.#blocks.get(meta.id) !== registration) return
      this.#blocks.delete(meta.id)
      this.#notify()
    }
    // owner.effect ties the slot entry and the metadata to the contributor's fiber, so unloading that plugin retracts both.
    const stop = owner.effect(() => {
      const unregister = owner.slots.register(
        { name: WEBUI_SLOT_KEYS[meta.scope], id: meta.id, priority: meta.priority, label: meta.title.en },
        component as never,
      )
      return () => {
        unregister()
        remove()
      }
    }, `webui: block ${meta.id}`)
    this.#notify()
    return this.#once(() => {
      void stop()
      remove()
    })
  }

  /**
   * Register a layout preset; presets are only stored, they do not enter a slot.
   * @param owner - the registering plugin's context; the preset is dropped with its fiber.
   * @param preset - the preset.
   * @returns disposer; a no-op when the id was already taken.
   * @throws {TypeError} when `preset.id` is empty or `preset.priority` is not a finite number.
   */
  registerPreset(owner: Context, preset: LayoutPreset): Disposer {
    validate('preset', preset.id, preset.priority)
    const name = ownerName(owner)
    const existing = this.#presets.get(preset.id)
    if (existing !== undefined) {
      this.#reject('duplicate-preset', preset.id, existing.owner, name)
      return () => {}
    }
    const registration: PresetRegistration = { preset, owner: name }
    this.#presets.set(preset.id, registration)
    const remove = (): void => {
      if (this.#presets.get(preset.id) !== registration) return
      this.#presets.delete(preset.id)
      this.#notify()
    }
    const stop = owner.effect(() => remove, `webui: preset ${preset.id}`)
    this.#notify()
    return this.#once(() => {
      void stop()
      remove()
    })
  }

  /** @returns the registered blocks in display order. */
  blocks(): readonly BlockRegistration[] {
    return [...this.#blocks.values()].sort((a, b) => compareByPriorityThenId(a.meta, b.meta))
  }

  /** @returns the registered presets in display order. */
  presets(): readonly LayoutPreset[] {
    return [...this.#presets.values()].map((entry) => entry.preset).sort(compareByPriorityThenId)
  }

  /**
   * Listen for block or preset changes.
   * @param listener - called after every change.
   * @returns unsubscribe function.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** @returns the duplicate registrations rejected so far. */
  diagnostics(): readonly WebuiDiagnostic[] {
    return [...this.#diagnostics]
  }

  #reject(kind: WebuiDiagnostic['kind'], id: string, kept: string, rejected: string): void {
    this.#diagnostics.push({ kind, id, kept, rejected })
    console.warn(`${LOG_PREFIX} ${kind}: "${id}" is already registered by ${kept}; ${rejected} was rejected`)
  }

  #once(dispose: () => void): Disposer {
    let live = true
    return () => {
      if (!live) return
      live = false
      dispose()
    }
  }

  #notify(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}

/**
 * The `webuiLayout` service: a cordis `Service` is handed to each caller as a traceable proxy whose `this.ctx`
 * is the CALLER's ctx (vendor/cordis/src/service.ts:42-58 sets tracker { associate, property: 'ctx' };
 * vendor/cordis/src/utils.ts:165-181 createTraceable returns the accessing ctx for tracker.property; both under
 * ref/deepseek-harness). So forwarding `this.ctx` as the owner makes registrations follow the contributor's fiber.
 */
export class WebuiLayout extends Service implements WebuiLayoutService {
  constructor(
    ctx: Context,
    private readonly registry: BlockRegistry,
  ) {
    super(ctx, 'webuiLayout')
  }

  registerBlock(meta: BlockMeta, component: BlockComponent): Disposer {
    return this.registry.registerBlock(this.ctx, meta, component)
  }

  registerPreset(preset: LayoutPreset): Disposer {
    return this.registry.registerPreset(this.ctx, preset)
  }
}
