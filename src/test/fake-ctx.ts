/**
 * Minimal fake cordis `Context` for unit tests: the services our client plugin
 * registers against, plus an inspection surface (`entries`, `registrations`)
 * so tests can assert what `apply` registered and that disposal cleans it up.
 */
import type { Context } from '@deepseek-ai/cordis'

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
export interface FakeSlots {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, callback: () => unknown): () => void
  provideRoot(contribution: unknown): () => void
  onEntryError(listener: EntryErrorListener): () => void
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
export interface FakeLocale {
  register(namespace: string, dictionaries: Record<string, Record<string, string>>): () => void
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
  const entryErrorListeners: EntryErrorListener[] = []
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()
  const activePlugins: string[] = []

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
      const registration: FakeSlotRegistration = { options: { name: String(options.name) }, component }
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
      return track(() => {
        const index = registrations.indexOf(registration)
        if (index >= 0) registrations.splice(index, 1)
      })
    },
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
      for (const listener of [...entryErrorListeners]) listener(key, registration, error, info)
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
      const registration: FakeLocaleRegistration = { namespace, dictionaries }
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
