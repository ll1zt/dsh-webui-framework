import type { Context } from '@deepseek-ai/cordis'
import type { BlockMeta } from '@lllzt/dsh-webui-framework/contract'
import { describe, expect, it } from 'vitest'
import { createFakeContext, type FakeContext, type FakeSlots } from '../../test/fake-ctx.ts'
import * as entry from '../index.ts'
import { createDock } from '../services/dock-state.ts'
import { sessionInjectFor, stateSourceOf } from '../services/session-adapter.ts'
import { WEBUI_SLOT_KEYS } from '../types.ts'
import { FEATURES } from './index.ts'
import { session } from './session.ts'

type HostBinding = Parameters<typeof stateSourceOf>[0]
type HostSessions = Parameters<typeof sessionInjectFor>[0]

/** A borrowed binding, cast to the adapter's parameter so this file does not import the host session package. */
function bindingFor(sessionId: string): HostBinding {
  const snapshot = {
    pendingSubmissions: [],
    hasMore: false,
    sessionId,
    running: false,
    blank: false,
    removed: false,
    openState: 'open',
    lastAgentError: null,
  }
  return {
    session: {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      prompt: () => Promise.resolve({ ok: true }),
      cancel: () => Promise.resolve({ ok: true }),
    },
  } as unknown as HostBinding
}

function sessionsFor(binding: HostBinding, sessionId: string): HostSessions {
  return {
    binding: (id: string) => (id === sessionId ? binding : undefined),
  } as unknown as HostSessions
}

const BLOCK: BlockMeta = {
  id: 'note-9',
  scope: 'session',
  priority: 1,
  title: { zh: 'note-9', en: 'note-9' },
  closable: true,
  multiInstance: false,
}

function injectOf(ctx: FakeContext): (sessionId: string) => {
  hooks: { webuiSession: unknown }
  webuiSessionActions: unknown
} {
  const slots: FakeSlots = ctx.slots
  const inject = slots.entries(WEBUI_SLOT_KEYS.session)[0]?.options.inject
  if (typeof inject !== 'function') throw new Error('the session block was not registered with inject')
  return inject as (sessionId: string) => {
    hooks: { webuiSession: unknown }
    webuiSessionActions: unknown
  }
}

describe('session feature', () => {
  it('A9 session is the feature after shortcuts and its inject follows sessionInjectFor until the context is disposed', () => {
    const names = FEATURES.map((feature) => feature.name)
    expect(names.indexOf('session')).toBe(names.indexOf('shortcuts') + 1)
    expect(session.name).toBe('session')
    expect(session.inject).toEqual(['sessions'])

    const binding = bindingFor('s1')
    const sessions = sessionsFor(binding, 's1')
    const ctx = createFakeContext({ sessions, fiber: { name: 'alpha' } })
    ctx.slots.declare(WEBUI_SLOT_KEYS.session)
    const dock = createDock()
    ctx.plugin({ name: session.name, inject: session.inject, apply: (sub: Context) => session.apply(sub, dock) })
    expect(ctx.activePlugins).toContain('session')

    dock.registry.registerBlock(ctx, BLOCK, () => null)
    const inject = injectOf(ctx)
    const face = inject('s1')
    const expected = sessionInjectFor(sessions)('s1')
    expect(face.hooks.webuiSession).toBe(stateSourceOf(binding))
    expect(face.hooks.webuiSession).toBe(expected.hooks.webuiSession)
    expect(face.webuiSessionActions).toBe(expected.webuiSessionActions)

    ctx.disposeAll()
    expect(() => inject('s1')).toThrow(Error)
  })

  it('A9 without a sessions service the session feature stays inactive while the others still apply', () => {
    const ctx = createFakeContext()
    expect(() => entry.apply(ctx)).not.toThrow()

    expect(ctx.activePlugins).not.toContain('session')
    expect(ctx.activePlugins).toEqual(['shell', 'layout', 'shortcuts'])
    expect(ctx.slots.entries('root')).toHaveLength(1)
    ctx.disposeAll()
  })
})
