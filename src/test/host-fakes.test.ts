import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  createFakeContext,
  type FakeLocale,
  type FakeSlots,
  type HostLocaleSurface,
  type HostSlotSurface,
} from './fake-ctx.ts'

/** Host members the slot fake must expose, and no others besides the test-only switches. */
const HOST_SLOT_KEYS = ['register', 'inject', 'provideRoot', 'onEntryError', 'subscribe'] as const

/** Host members the locale fake must expose. */
const HOST_LOCALE_KEYS = ['register', 'bind'] as const

/**
 * FakeSlots members that are test switches, not part of the host surface.
 * `spec` is one of them: the surface pick leaves it off even though SlotRegistry declares it.
 */
type SlotTestOnly =
  | 'refuseUndeclared'
  | 'spec'
  | 'enableDeclarationEpoch'
  | 'declare'
  | 'reportEntryError'
  | 'entries'
  | 'injected'
  | 'providedRoots'

/** FakeLocale's inspection list; register and bind come from the host. */
type LocaleTestOnly = 'registrations'

describe('host fakes align with the installed host types', () => {
  it('A1 fake slots and locale cover exactly the host pick and assign to it', () => {
    expectTypeOf<HostSlotSurface>().toEqualTypeOf<
      Pick<SlotRegistry, 'register' | 'inject' | 'provideRoot' | 'onEntryError' | 'subscribe'>
    >()
    expectTypeOf<HostLocaleSurface>().toEqualTypeOf<Pick<LocaleRuntime, 'register' | 'bind'>>()

    expectTypeOf<Exclude<keyof HostSlotSurface, keyof FakeSlots>>().toBeNever()
    expectTypeOf<Exclude<keyof FakeSlots, keyof HostSlotSurface | SlotTestOnly>>().toBeNever()
    expectTypeOf<Exclude<keyof HostLocaleSurface, keyof FakeLocale>>().toBeNever()
    expectTypeOf<Exclude<keyof FakeLocale, keyof HostLocaleSurface | LocaleTestOnly>>().toBeNever()

    expectTypeOf<(typeof HOST_SLOT_KEYS)[number]>().toEqualTypeOf<keyof HostSlotSurface>()
    expectTypeOf<(typeof HOST_LOCALE_KEYS)[number]>().toEqualTypeOf<keyof HostLocaleSurface>()

    const ctx = createFakeContext()
    // Go through the fake types. `ctx.slots` is also the host registry (FakeContext intersects
    // Context), so assigning ctx.slots itself would stay green even if the fake drifted.
    const asSlots: FakeSlots = ctx.slots
    const slots: HostSlotSurface = asSlots
    const asLocale: FakeLocale = ctx.locale
    const locale: HostLocaleSurface = asLocale

    expect([...HOST_SLOT_KEYS].sort()).toEqual(['inject', 'onEntryError', 'provideRoot', 'register', 'subscribe'])
    expect([...HOST_LOCALE_KEYS].sort()).toEqual(['bind', 'register'])
    expect(typeof slots.register).toBe('function')
    expect(typeof slots.inject).toBe('function')
    expect(typeof slots.provideRoot).toBe('function')
    expect(typeof slots.onEntryError).toBe('function')
    expect(typeof slots.subscribe).toBe('function')
    expect(typeof locale.register).toBe('function')
    expect(typeof locale.bind).toBe('function')
  })

  it('A2 a host rename of a picked member fails typecheck and names that key', () => {
    // A host rename or deletion of a member the fake picks makes this line fail to compile and names that key.
    // @ts-expect-error a host rename makes this line fail to compile and names the missing slot member
    type _DroppedSlotMember = Pick<SlotRegistry, 'noSuchMember'>
    // A host rename or deletion of a member the fake picks makes this line fail to compile and names that key.
    // @ts-expect-error a host rename makes this line fail to compile and names the missing locale member
    type _DroppedLocaleMember = Pick<LocaleRuntime, 'noSuchMember'>

    // Fixed list: a host rename changes keyof, so this snapshot must be edited on purpose.
    expectTypeOf<(typeof HOST_SLOT_KEYS)[number]>().toEqualTypeOf<keyof HostSlotSurface>()
    expectTypeOf<(typeof HOST_LOCALE_KEYS)[number]>().toEqualTypeOf<keyof HostLocaleSurface>()
    expect([...HOST_SLOT_KEYS].sort()).toEqual(['inject', 'onEntryError', 'provideRoot', 'register', 'subscribe'])
    expect([...HOST_LOCALE_KEYS].sort()).toEqual(['bind', 'register'])
  })
})
