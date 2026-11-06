/**
 * Minimal fake cordis `Context` for unit tests: the services our client plugin
 * registers against, plus an inspection surface (`entries`, `registrations`)
 * so tests can assert what `apply` registered and that disposal cleans it up.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'

/**
 * Host slot members the fake must keep. Deleting or renaming one of these keys fails typecheck and names that key.
 * `spec` stays off this list: the fake's `spec` is a test inspection switch, not the host method.
 */
export type HostSlotSurface = Pick<SlotRegistry, 'register' | 'inject' | 'provideRoot' | 'onEntryError' | 'subscribe'>

/** Host locale members the fake must keep. Deleting or renaming one of these keys fails typecheck and names that key. */
export type HostLocaleSurface = Pick<LocaleRuntime, 'register' | 'bind'>

/** Listener parameter of the host's `slots.onEntryError` (a stored entry or factory, not `unknown`). */
type HostEntryErrorListener = Parameters<HostSlotSurface['onEntryError']>[0]

/** One `slots.register` call, in the shape the slot ledger exposes it. */
export interface FakeSlotRegistration {
  /** Raw options object the plugin passed to `slots.register`. */
  options: {
    name: string
    key?: string
    id?: string
    order?: number
    priority?: number
    locale?: string
    store?: unknown
    children?: unknown
    inject?: unknown
  }
  component: unknown
  locale?: string
  store?: unknown
  children?: unknown
}

/** Shape of a `ctx.slots.onEntryError` listener. */
export type EntryErrorListener = (
  key: string,
  registration: unknown,
  error: unknown,
  info: { abdicated: boolean },
) => void

/** `ctx.slots` recorder: registrations are kept per slot name until disposed. */
export interface FakeSlots extends HostSlotSurface {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, callback: () => unknown): () => void
  provideRoot(contribution: unknown): () => void
  /** Host listener shape, so a change to that parameter fails assignability here and names `onEntryError`. */
  onEntryError(listener: HostEntryErrorListener): () => void
  /**
   * Test switch: when true, `register` refuses a key no entry has declared yet, the way the host does
   * (`a parent entry's children table must declare it`). Off by default, so tests that predate declarations
   * keep registering into bare keys.
   */
  refuseUndeclared: boolean
  /** The declared spec of a key, `undefined` while no entry's `children` table (or `declare`) has declared it. */
  spec(key: string): unknown
  /**
   * Listeners of a key, notified once per microtask-batched flush after the key gains or loses an entry or is declared,
   * the way the host's `ctx.slots.subscribe` does; the disposer unsubscribes.
   */
  subscribe(key: string, callback: () => void): () => void
  /**
   * Test switch: add the slot core's synchronous `declarationEpoch` / `subscribeDeclaration` pair, which the host's
   * `ctx.slots` does not expose, so a test can check that the epoch pair is preferred when it exists.
   */
  enableDeclarationEpoch(): void
  /** Test trigger: declare a key the way a parent entry's `children` table does. */
  declare(key: string): void
  /** Test trigger: call every `onEntryError` listener the way the host reports a failed entry. */
  reportEntryError(key: string, registration: unknown, error: unknown, info: { abdicated: boolean }): void
  entries(key: string): readonly FakeSlotRegistration[]
  readonly injected: readonly { key: string; callback: () => unknown }[]
  readonly providedRoots: readonly unknown[]
}

/** One `locale.register` call: namespace plus its dictionaries by locale id. */
export interface FakeLocaleRegistration {
  namespace: string
  dictionaries: Record<string, Record<string, string>>
}

/** `ctx.locale` recorder. */
export interface FakeLocale extends HostLocaleSurface {
  /**
   * Dictionary form the tests call. The second argument also accepts a locale id so this stays assignable to the
   * host's `(ns, locale, dict)` overload; the recorder only stores the dictionary form.
   */
  register(
    namespace: string,
    dictionaries: Record<string, Record<string, string>> | string,
    dict?: Record<string, string>,
  ): () => void
  bind(namespace: string): (key: string) => string
  readonly registrations: readonly FakeLocaleRegistration[]
}

/** The fake's own surface; a `Context` intersection keeps `apply(ctx)` cast-free at call sites. */
export interface FakeContextInspection {
  slots: FakeSlots
  locale: FakeLocale
  effect(callback: () => void | (() => void), label?: string): void
  on(event: string, listener: (...args: unknown[]) => void): () => void
  emit(event: string, ...args: unknown[]): void
  /**
   * Load a feature the way cordis does: `feature.apply(ctx)` runs only when every service in `feature.inject`
   * exists on this context; otherwise the feature stays inactive and nothing is applied.
   */
  plugin(feature: { name?: string; inject?: readonly string[]; apply(ctx: Context): void }): void
  /**
   * Wait for services the way `ctx.inject` does: `callback` runs with this context once every named service exists on it
   * (now, or never here: the fake does not watch for services added later); returns the disposer of what it started.
   */
  inject(names: readonly string[], callback: (ctx: Context) => void): () => void
  /** Names of the features `plugin` activated, in activation order. */
  readonly activePlugins: readonly string[]
  /** Dispose everything collected, in reverse order, and empty every record. */
  disposeAll(): void
}

/** The test context: callable as a host `Context`, inspectable as a fake. */
export type FakeContext = Context & FakeContextInspection

/**
 * Build a ready-to-use fake context.
 * @param overrides - services merged over the fake before returning.
 * @returns the fake context.
 */
export function createFakeContext(overrides: Record<string, unknown> = {}): FakeContext {
  const disposers: (() => void)[] = []
  const registrations: FakeSlotRegistration[] = []
  const localeRegistrations: FakeLocaleRegistration[] = []
  const injected: { key: string; callback: () => unknown }[] = []
  const providedRoots: unknown[] = []
  const entryErrorListeners: HostEntryErrorListener[] = []
  const specs = new Map<string, unknown>()
  const declarationEpochs = new Map<string, number>()
  const declarationListeners = new Map<string, Set<() => void>>()
  const subscribers = new Map<string, Set<() => void>>()
  const dirtyKeys = new Set<string>()
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const activePlugins: string[] = []
  let refuseUndeclared = false

  // One flush per tick however many mutations touched a key, like the host's markDirty/flush.
  const markDirty = (key: string): void => {
    if (dirtyKeys.size === 0) {
      queueMicrotask(() => {
        const keys = [...dirtyKeys]
        dirtyKeys.clear()
        for (const dirty of keys) for (const listener of [...(subscribers.get(dirty) ?? [])]) listener()
      })
    }
    dirtyKeys.add(key)
  }

  const declareKey = (key: string, spec: unknown): void => {
    specs.set(key, spec)
    declarationEpochs.set(key, (declarationEpochs.get(key) ?? 0) + 1)
    markDirty(key)
  }

  const notifyDeclaration = (key: string): void => {
    for (const listener of [...(declarationListeners.get(key) ?? [])]) listener()
  }

  const declare = (key: string): void => {
    declareKey(key, { kind: 'list' })
    notifyDeclaration(key)
  }

  const track = (dispose: () => void): (() => void) => {
    let live = true
    const once = (): void => {
      if (!live) return
      live = false
      dispose()
    }
    disposers.push(once)
    return once
  }

  const slots: FakeSlots = {
    register(options, component) {
      const name = String(options.name)
      if (refuseUndeclared && !specs.has(name)) {
        throw new Error(`slot "${name}" is not declared (a parent entry's children table must declare it)`)
      }
      const registration: FakeSlotRegistration = { options: { name }, component }
      const { priority, locale, store, children, inject } = options
      if (typeof priority === 'number') registration.options.priority = priority
      if (typeof options.key === 'string') registration.options.key = options.key
      if (typeof options.id === 'string') registration.options.id = options.id
      if (typeof options.order === 'number') registration.options.order = options.order
      if (typeof locale === 'string') {
        registration.options.locale = locale
        registration.locale = locale
      }
      if (store !== undefined) {
        registration.options.store = store
        registration.store = store
      }
      if (children !== undefined) {
        registration.options.children = children
        registration.children = children
      }
      if (inject !== undefined) registration.options.inject = inject
      registrations.push(registration)
      // The host publishes the entry first and its children table last, committing every sibling declaration
      // before the first notification (ref/deepseek-harness/packages/client/ui-slots/src/index.ts:1245-1310).
      const childTable =
        children === undefined || children === null || typeof children !== 'object'
          ? {}
          : (children as Record<string, unknown>)
      const childKeys = Object.keys(childTable)
      for (const childKey of childKeys) declareKey(childKey, childTable[childKey])
      markDirty(name)
      for (const childKey of childKeys) notifyDeclaration(childKey)
      return track(() => {
        const index = registrations.indexOf(registration)
        if (index < 0) return
        registrations.splice(index, 1)
        markDirty(name)
      })
    },
    get refuseUndeclared() {
      return refuseUndeclared
    },
    set refuseUndeclared(value: boolean) {
      refuseUndeclared = value
    },
    spec(key) {
      return specs.get(key)
    },
    subscribe(key, callback) {
      const set = subscribers.get(key) ?? new Set<() => void>()
      subscribers.set(key, set)
      set.add(callback)
      return track(() => {
        set.delete(callback)
      })
    },
    enableDeclarationEpoch() {
      Object.assign(slots, {
        declarationEpoch: (key: string): number => declarationEpochs.get(key) ?? 0,
        subscribeDeclaration: (key: string, callback: () => void): (() => void) => {
          const set = declarationListeners.get(key) ?? new Set<() => void>()
          declarationListeners.set(key, set)
          set.add(callback)
          return track(() => {
            set.delete(callback)
          })
        },
      })
    },
    declare,
    inject(key, callback) {
      const record = { key, callback }
      injected.push(record)
      return track(() => {
        const index = injected.indexOf(record)
        if (index >= 0) injected.splice(index, 1)
      })
    },
    provideRoot(contribution) {
      providedRoots.push(contribution)
      return track(() => {
        const index = providedRoots.indexOf(contribution)
        if (index >= 0) providedRoots.splice(index, 1)
      })
    },
    onEntryError(listener) {
      entryErrorListeners.push(listener)
      return track(() => {
        const index = entryErrorListeners.indexOf(listener)
        if (index >= 0) entryErrorListeners.splice(index, 1)
      })
    },
    reportEntryError(key, registration, error, info) {
      for (const listener of [...entryErrorListeners]) {
        // Test triggers pass plain objects; the host types this argument as StoredEntry | StoredFactory.
        ;(listener as EntryErrorListener)(key, registration, error, info)
      }
    },
    entries(key) {
      return registrations.filter((registration) => registration.options.name === key)
    },
    get injected() {
      return injected
    },
    get providedRoots() {
      return providedRoots
    },
  }

  const locale: FakeLocale = {
    register(namespace, dictionaries) {
      // The host's other overload types this argument as a locale id; tests only pass the dictionary form.
      const recorded = dictionaries as Record<string, Record<string, string>>
      const registration: FakeLocaleRegistration = { namespace, dictionaries: recorded }
      localeRegistrations.push(registration)
      return track(() => {
        const index = localeRegistrations.indexOf(registration)
        if (index >= 0) localeRegistrations.splice(index, 1)
      })
    },
    bind(namespace) {
      return (key: string): string => {
        const registration = localeRegistrations.find((entry) => entry.namespace === namespace)
        return registration?.dictionaries.zh?.[key] ?? key
      }
    },
    get registrations() {
      return localeRegistrations
    },
  }

  const effect = (callback: () => void | (() => void), _label?: string): void => {
    const dispose = callback()
    track(typeof dispose === 'function' ? dispose : () => {})
  }

  const on = (event: string, listener: (...args: unknown[]) => void): (() => void) => {
    const set = listeners.get(event) ?? new Set<(...args: unknown[]) => void>()
    listeners.set(event, set)
    set.add(listener)
    return track(() => {
      set.delete(listener)
    })
  }

  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
  }

  const disposeAll = (): void => {
    while (disposers.length > 0) disposers.pop()?.()
    registrations.length = 0
    localeRegistrations.length = 0
    injected.length = 0
    providedRoots.length = 0
    entryErrorListeners.length = 0
    specs.clear()
    declarationEpochs.clear()
    declarationListeners.clear()
    subscribers.clear()
    dirtyKeys.clear()
    refuseUndeclared = false
    listeners.clear()
    activePlugins.length = 0
  }

  // Defined on the merged object so a feature sees the services overrides add; overrides may also replace `plugin`.
  const plugin = (feature: { name?: string; inject?: readonly string[]; apply(ctx: Context): void }): void => {
    const services = fake as unknown as Record<string, unknown>
    if ((feature.inject ?? []).some((service) => services[service] === undefined)) return
    const name = feature.name ?? ''
    activePlugins.push(name)
    track(() => {
      const index = activePlugins.indexOf(name)
      if (index >= 0) activePlugins.splice(index, 1)
    })
    feature.apply(fake as unknown as Context)
  }

  const inject = (names: readonly string[], callback: (ctx: Context) => void): (() => void) => {
    const services = fake as unknown as Record<string, unknown>
    if (names.some((service) => services[service] === undefined)) return () => {}
    callback(fake as unknown as Context)
    return () => {}
  }

  // Service subclasses announce themselves through `ctx.reflect.provide`; the fake needs no registry for them.
  const reflect = { provide: (): (() => void) => () => {} }

  const fake = Object.assign(
    { slots, locale, reflect, effect, on, emit, plugin, inject, activePlugins, disposeAll },
    overrides,
  )
  // A real context points at its root; this one is its own root, so features can key shared state by it.
  Object.assign(fake, { root: fake })
  // A cordis Context is a class whose private members no plain object can mirror, so this single cast is
  // the one place the fake claims the host type; every test then calls `apply(ctx)` without casting.
  return fake as unknown as FakeContext
}
