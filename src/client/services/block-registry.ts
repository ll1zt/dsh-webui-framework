/** Block and preset registry behind the `webuiLayout` service: validation, ordering, duplicate diagnostics. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { createElement, type ComponentType, type FunctionComponent } from 'react'
import type {
  BlockComponent,
  BlockComponentOf,
  BlockInstanceProps,
  BlockMeta,
  Disposer,
  LayoutPreset,
  SessionBlockProps,
  WebuiLayoutService,
} from '@lllzt/dsh-webui-framework/contract'
import { WEBUI_CONTRACT_VERSION } from '../../lib/contract-version.ts'
import { WEBUI_SLOT_KEYS } from '../types.ts'
import { LOG_PREFIX } from './log-prefix.ts'
import type { WebuiSessionInject } from './session-adapter.ts'
import { bridgeSessionBlock } from './session-bridge.tsx'

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

function isFunctionComponent(component: BlockComponent): component is FunctionComponent<BlockInstanceProps> {
  return component.prototype?.isReactComponent === undefined
}

/**
 * A slot takes a function component while a BlockComponent may be a class: a class is wrapped,
 * handing every prop through, and a function component is registered as it is.
 */
function asFunctionComponent(component: BlockComponent): FunctionComponent<BlockInstanceProps> {
  return isFunctionComponent(component) ? component : (props) => createElement(component, props)
}

function ownerName(owner: Context): string {
  return owner.fiber.name || UNNAMED_OWNER
}

/** The declaration surface of `ctx.slots` this package waits on. */
export interface SlotDeclarations {
  /**
   * @param key - slot key.
   * @returns whether a parent entry has declared the key, so entries may enter it.
   */
  declared(key: string): boolean
  /**
   * @param key - slot key.
   * @param listener - called for every declaration lifetime boundary of that key.
   * @returns unsubscribe function.
   */
  onDeclared(key: string, listener: () => void): () => void
}

/**
 * Read the host's declaration surface. The slot core publishes declarations as `declarationEpoch`/
 * `subscribeDeclaration`, while the renderer's registry service, which is what `ctx.slots` actually is,
 * exposes them as `spec`/`subscribe`. A host with neither predates the declaration ledger, and its slots
 * accept entries at once, which is the behaviour this package had before it waited on declarations.
 * @param slots - the `ctx.slots` service of the registering context.
 * @returns the declaration surface, backed by whichever pair the host publishes.
 */
export function slotDeclarationsOf(slots: unknown): SlotDeclarations {
  const surface = slots as {
    declarationEpoch?(key: string): number
    subscribeDeclaration?(key: string, listener: () => void): () => void
    spec?(key: string): unknown
    subscribe?(key: string, listener: () => void): () => void
  }
  const { declarationEpoch, subscribeDeclaration, spec, subscribe } = surface
  return {
    declared(key: string): boolean {
      if (typeof declarationEpoch === 'function') return declarationEpoch.call(surface, key) > 0
      if (typeof spec === 'function') return spec.call(surface, key) !== undefined
      return true
    },
    onDeclared(key: string, listener: () => void): () => void {
      const watch = typeof subscribeDeclaration === 'function' ? subscribeDeclaration : subscribe
      if (typeof watch !== 'function') return () => {}
      return watch.call(surface, key, listener)
    },
  }
}

/** Holds the registered blocks and presets; slot entries follow the registering plugin's fiber. */
export class BlockRegistry {
  readonly #blocks = new Map<string, BlockRegistration>()
  /** Blocks holding back for their slot declaration; they count for the duplicate check but are not in `blocks()`. */
  readonly #waiting = new Map<string, BlockRegistration>()
  readonly #presets = new Map<string, PresetRegistration>()
  readonly #remounts = new Map<string, () => void>()
  readonly #diagnostics: WebuiDiagnostic[] = []
  readonly #listeners = new Set<() => void>()
  /** Factory the session feature installs; session entries read it when their inject runs, not when they register. */
  #sessionInject: ((sessionId: string) => WebuiSessionInject) | undefined = undefined

  /**
   * Register a block and put its component into the slot of `meta.scope`. A slot the host has not declared yet
   * holds the block back: it enters neither the slot nor `blocks()` until the declaration arrives, so the call
   * never throws and leaves no entry behind.
   * @param owner - the registering plugin's context; the slot entry is torn down with its fiber.
   * @param meta - block metadata.
   * @param component - block component.
   * @returns disposer; a no-op when the id was already taken.
   * @throws {TypeError} when `meta.id` is empty or `meta.priority` is not a finite number.
   */
  registerBlock(owner: Context, meta: BlockMeta, component: BlockComponent): Disposer {
    validate('block', meta.id, meta.priority)
    const name = ownerName(owner)
    const existing = this.#blocks.get(meta.id) ?? this.#waiting.get(meta.id)
    if (existing !== undefined) {
      this.#reject('duplicate-block', meta.id, existing.owner, name)
      return () => {}
    }
    const registration: BlockRegistration = { meta, component, owner: name }
    const remove = (): void => {
      if (this.#blocks.get(meta.id) !== registration) return
      this.#blocks.delete(meta.id)
      this.#remounts.delete(meta.id)
      this.#notify()
    }
    const slotKey = WEBUI_SLOT_KEYS[meta.scope]
    let unregister: (() => void) | undefined
    // The wrapper and its inject are created once per registration, outside mount, so remount reuses both.
    // Creating the wrapper during render would change the component type and remount the block.
    let mount: () => void
    if (meta.scope === 'session') {
      // The registry stores every block as BlockComponent. A session component's props are a subtype, so the
      // class form is not assignable without a cast: its instance `props` would lack `session`.
      const bridge = bridgeSessionBlock(component as ComponentType<SessionBlockProps>)
      const blockId = meta.id
      const inject = (sessionId: string): WebuiSessionInject => {
        const factory = this.#sessionInject
        if (factory === undefined) {
          throw new Error(`${LOG_PREFIX} block "${blockId}" has no sessions service`)
        }
        return factory(sessionId)
      }
      mount = (): void => {
        // One cast: `register` demands a component of `ComposedProps` (host standard props, which ui-session merges
        // in and this compilation does not see, plus the inject face). The bridge only declares the props it reads.
        unregister = owner.slots.register(
          { name: WEBUI_SLOT_KEYS.session, id: meta.id, priority: meta.priority, label: meta.title.en, inject },
          bridge as never,
        )
      }
    } else {
      const slotComponent = asFunctionComponent(component)
      mount = (): void => {
        unregister = owner.slots.register(
          { name: slotKey, id: meta.id, priority: meta.priority, label: meta.title.en },
          slotComponent,
        )
      }
    }
    // The block joins #blocks only once its slot entry exists, so a registration that cannot mount leaves no tab behind.
    const adopt = (): void => {
      if (this.#blocks.get(meta.id) === registration) return
      mount()
      this.#blocks.set(meta.id, registration)
      this.#remounts.set(meta.id, () => {
        unregister?.()
        mount()
      })
      this.#notify()
    }
    const declarations = slotDeclarationsOf(owner.slots)
    let unsubscribe: () => void = () => {}
    const stopWaiting = (): void => {
      if (this.#waiting.get(meta.id) === registration) this.#waiting.delete(meta.id)
    }
    // A late mount runs inside the declaring entry's register call, so its failure must not reach the slot ledger.
    // The block gets one attempt: once the declaration is seen it stops waiting, whether the mount succeeds or not.
    const adoptLate = (): void => {
      if (this.#waiting.get(meta.id) !== registration || !declarations.declared(slotKey)) return
      unsubscribe()
      stopWaiting()
      try {
        adopt()
      } catch (error) {
        console.warn(`${LOG_PREFIX} block "${meta.id}" did not enter slot "${slotKey}": ${String(error)}`)
      }
    }
    // owner.effect ties the slot entry and the metadata to the contributor's fiber, so unloading that plugin retracts both.
    const stop = owner.effect(() => {
      if (declarations.declared(slotKey)) {
        adopt()
        return () => {
          unregister?.()
          unregister = undefined
          remove()
        }
      }
      this.#waiting.set(meta.id, registration)
      unsubscribe = declarations.onDeclared(slotKey, adoptLate)
      return () => {
        unsubscribe()
        stopWaiting()
        unregister?.()
        unregister = undefined
        remove()
      }
    }, `webui: block ${meta.id}`)
    return this.#once(() => {
      void stop()
      remove()
    })
  }

  /**
   * Dispose the slot entry of a block and register it again through the same owner, so the host renders it afresh.
   * @param blockId - id of a block registered through `registerBlock`.
   * @returns whether the block was remounted; false for an id that did not come through `registerBlock`.
   */
  remount(blockId: string): boolean {
    const remount = this.#remounts.get(blockId)
    if (remount === undefined) return false
    remount()
    return true
  }

  /**
   * Install or clear the factory a session block's inject calls.
   * Already registered blocks see the change on their next inject, without being registered again.
   * @param factory - builds the inject face for a session id, or `undefined` when `sessions` is gone.
   */
  setSessionInject(factory: ((sessionId: string) => WebuiSessionInject) | undefined): void {
    this.#sessionInject = factory
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
  readonly contractVersion: string = WEBUI_CONTRACT_VERSION

  constructor(
    ctx: Context,
    private readonly registry: BlockRegistry,
  ) {
    super(ctx, 'webuiLayout')
  }

  registerBlock<M extends BlockMeta>(meta: M, component: BlockComponentOf<M>): Disposer {
    // The registry stores every block as BlockComponent; scope only narrows the props type at this boundary.
    return this.registry.registerBlock(this.ctx, meta, component as BlockComponent)
  }

  registerPreset(preset: LayoutPreset): Disposer {
    return this.registry.registerPreset(this.ctx, preset)
  }
}
