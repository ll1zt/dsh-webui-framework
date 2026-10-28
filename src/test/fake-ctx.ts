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
  }
  component: unknown
  locale?: string
  store?: unknown
  children?: unknown
}

/** `ctx.slots` recorder: registrations are kept per slot name until disposed. */
export interface FakeSlots {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(key: string, callback: () => unknown): () => void
  provideRoot(contribution: unknown): () => void
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
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

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
      const { priority, locale, store, children } = options
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
    listeners.clear()
  }

  const fake = Object.assign({ slots, locale, effect, on, emit, disposeAll }, overrides)
  // A cordis Context is a class whose private members no plain object can mirror, so this single cast is
  // the one place the fake claims the host type; every test then calls `apply(ctx)` without casting.
  return fake as unknown as FakeContext
}
