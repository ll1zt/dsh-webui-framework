// @vitest-environment happy-dom
import { Context } from '@deepseek-ai/cordis'
import type { BlockComponent, BlockMeta, LayoutPreset, WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeContext, type FakeContext, type FakeSlots } from '../../test/fake-ctx.ts'
import { FEATURES } from '../features/index.ts'
import { BlockRegistry, compareByPriorityThenId } from './block-registry.ts'
import { createDock } from './dock-state.ts'
import { LOG_PREFIX } from './log-prefix.ts'
import type { WebuiSessionInject } from './session-adapter.ts'

const ROOT_KEY = 'webui.block.root'
const SESSION_KEY = 'webui.block.session'

const Component: BlockComponent = () => null
const OTHER: BlockComponent = () => null
const EMPTY_LAYOUT: WebuiLayout = { version: 1, root: null, activePane: [] }

function meta(id: string, priority = 0, scope: BlockMeta['scope'] = 'root'): BlockMeta {
  return { id, scope, priority, title: { zh: id, en: id }, closable: true, multiInstance: false }
}

function preset(id: string, priority = 0): LayoutPreset {
  return { id, priority, layout: EMPTY_LAYOUT }
}

/**
 * A real cordis root that provides the fake slots recorder, plus helpers to start contributor plugins.
 * Both block slots are declared by default, the way the root entry's children table declares them; pass
 * `declarations = []` for a host that has not declared anything yet.
 */
function setup(declarations: readonly string[] = [ROOT_KEY, SESSION_KEY]): {
  fake: FakeContext
  root: Context
  join(name: string): Promise<{ ctx: Context; unload(): Promise<void> }>
} {
  const fake = createFakeContext()
  for (const key of declarations) fake.slots.declare(key)
  const root = new Context()
  root.provide('slots', fake.slots)
  const join = async (name: string): Promise<{ ctx: Context; unload(): Promise<void> }> => {
    const captured: Context[] = []
    const fiber = await root.plugin({ name, apply: (ctx: Context) => void captured.push(ctx) })
    const ctx = captured[0]
    if (ctx === undefined) throw new Error(`contributor ${name} did not start`)
    return { ctx, unload: () => fiber.dispose() }
  }
  return { fake, root, join }
}

function ids(entries: readonly { options: { id?: string } }[]): (string | undefined)[] {
  return entries.map((entry) => entry.options.id)
}

/** One microtask: the host (and so the fake) notifies `slots.subscribe` listeners in a batched microtask flush. */
const microtask = (): Promise<void> => Promise.resolve()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BlockRegistry registration and disposal', () => {
  it('A1 a block registered by a contributor shows in its scope slot and goes away with its disposer', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')

    const disposeRoot = registry.registerBlock(alpha.ctx, meta('r1', 1, 'root'), Component)
    const disposeSession = registry.registerBlock(alpha.ctx, meta('s1', 2, 'session'), OTHER)

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['r1'])
    expect(ids(fake.slots.entries(SESSION_KEY))).toEqual(['s1'])
    expect(fake.slots.entries(ROOT_KEY)[0]?.component).toBe(Component)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['r1', 's1'])
    expect(registry.blocks().map((block) => block.owner)).toEqual(['alpha', 'alpha'])

    disposeRoot()
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(ids(fake.slots.entries(SESSION_KEY))).toEqual(['s1'])
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['s1'])

    disposeSession()
    expect(fake.slots.entries(SESSION_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
  })

  it('A1 a second call of a disposer does nothing, even after the id was registered again', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')

    const dispose = registry.registerBlock(alpha.ctx, meta('x'), Component)
    dispose()
    registry.registerBlock(alpha.ctx, meta('x'), OTHER)
    expect(() => dispose()).not.toThrow()

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['x'])
    expect(registry.blocks().map((block) => block.component)).toEqual([OTHER])
  })

  it('A1 unloading the contributor plugin removes its blocks and presets and leaves the others', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    const beta = await join('beta')

    registry.registerBlock(alpha.ctx, meta('a-root', 1, 'root'), Component)
    registry.registerBlock(alpha.ctx, meta('a-session', 2, 'session'), Component)
    registry.registerPreset(alpha.ctx, preset('a-preset'))
    registry.registerBlock(beta.ctx, meta('b-root', 3, 'root'), Component)
    registry.registerPreset(beta.ctx, preset('b-preset'))

    await alpha.unload()

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['b-root'])
    expect(fake.slots.entries(SESSION_KEY)).toHaveLength(0)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['b-root'])
    expect(registry.presets().map((entry) => entry.id)).toEqual(['b-preset'])
  })

  it('A1 contributors waiting with ctx.inject(webuiLayout) register through the layout feature and unload cleanly', async () => {
    const { fake, root } = setup()
    const layout = FEATURES.find((feature) => feature.name === 'layout')
    if (layout === undefined) throw new Error('FEATURES has no layout feature')
    const disposers: Record<string, () => void> = {}
    const contributor = (name: string, base: number) =>
      root.inject(['webuiLayout'], function contribute(ctx) {
        disposers[`${name}-root`] = ctx.webuiLayout.registerBlock(meta(`${name}-root`, base, 'root'), Component)
        ctx.webuiLayout.registerBlock(meta(`${name}-session`, base + 1, 'session'), Component)
        ctx.webuiLayout.registerPreset(preset(`${name}-preset`, base))
      })

    // Both contributors start waiting before the layout service exists.
    const alpha = contributor('alpha', 1)
    const beta = contributor('beta', 10)
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)

    const dock = createDock()
    await root.plugin({ name: layout.name, inject: layout.inject, apply: (ctx: Context) => layout.apply(ctx, dock) })
    await Promise.all([alpha, beta])

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['alpha-root', 'beta-root'])
    expect(ids(fake.slots.entries(SESSION_KEY))).toEqual(['alpha-session', 'beta-session'])

    // The disposer removes one block; unloading the contributor fiber removes the rest of its entries only.
    disposers['beta-root']?.()
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['alpha-root'])
    await alpha.dispose()
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(ids(fake.slots.entries(SESSION_KEY))).toEqual(['beta-session'])
    await beta.dispose()
    expect(fake.slots.entries(SESSION_KEY)).toHaveLength(0)
  })
})

describe('BlockRegistry before the slot is declared', () => {
  it('A1 a block registered before its slot is declared mounts once the declaration arrives and leaves nothing behind before', async () => {
    const { fake, join } = setup([])
    fake.slots.refuseUndeclared = true
    const registry = new BlockRegistry()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')

    let dispose: () => void = () => {}
    expect(() => {
      dispose = registry.registerBlock(alpha.ctx, meta('late', 1, 'root'), Component)
    }).not.toThrow()

    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
    expect(registry.diagnostics()).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()

    fake.slots.declare(ROOT_KEY)
    await microtask()

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['late'])
    expect(fake.slots.entries(ROOT_KEY)[0]?.component).toBe(Component)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['late'])
    expect(registry.diagnostics()).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()

    // A second declaration notification must not mount the block a second time.
    fake.slots.declare(ROOT_KEY)
    await microtask()
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['late'])
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['late'])

    dispose()
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
  })

  it('A1 a block cancelled before the declaration never mounts, whether its disposer ran or its plugin unloaded', async () => {
    const { fake, join } = setup([])
    fake.slots.refuseUndeclared = true
    const registry = new BlockRegistry()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')
    const beta = await join('beta')

    const disposeDropped = registry.registerBlock(alpha.ctx, meta('dropped', 1, 'root'), Component)
    registry.registerBlock(beta.ctx, meta('unloaded', 2, 'root'), OTHER)
    disposeDropped()
    await beta.unload()

    fake.slots.declare(ROOT_KEY)
    await microtask()

    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
  })

  it('A1 a declaration whose mount still throws warns once and leaves the block out of blocks()', async () => {
    const { fake, join } = setup([])
    fake.slots.refuseUndeclared = true
    const registry = new BlockRegistry()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')
    registry.registerBlock(alpha.ctx, meta('broken', 1, 'root'), Component)
    vi.spyOn(fake.slots, 'register').mockImplementation(() => {
      throw new Error('slot "webui.block.root" is not declared')
    })

    fake.slots.declare(ROOT_KEY)
    await microtask()

    expect(registry.blocks()).toHaveLength(0)
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0]).startsWith(LOG_PREFIX)).toBe(true)
  })

  it('A1 the host-faithful fake has only spec and subscribe, and a block waits for the microtask-batched declaration', async () => {
    const { fake, join } = setup([])
    fake.slots.refuseUndeclared = true
    expect('declarationEpoch' in fake.slots).toBe(false)
    expect('subscribeDeclaration' in fake.slots).toBe(false)
    const registry = new BlockRegistry()
    const alpha = await join('alpha')

    const dispose = registry.registerBlock(alpha.ctx, meta('late', 1, 'root'), Component)
    expect(registry.blocks()).toHaveLength(0)
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)

    fake.slots.declare(ROOT_KEY)
    expect(registry.blocks()).toHaveLength(0)
    await microtask()
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['late'])
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['late'])

    dispose()
    expect(registry.blocks()).toHaveLength(0)
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
  })

  it('A1 a host that exposes the epoch pair is waited on through it, mounting synchronously on declaration', async () => {
    const { fake, join } = setup([])
    fake.slots.enableDeclarationEpoch()
    fake.slots.refuseUndeclared = true
    const registry = new BlockRegistry()
    const alpha = await join('alpha')

    registry.registerBlock(alpha.ctx, meta('late', 1, 'root'), Component)
    expect(registry.blocks()).toHaveLength(0)

    fake.slots.declare(ROOT_KEY)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['late'])
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['late'])
  })

  it('A2 a block whose mount keeps failing after the declaration is tried and warned about once, however often the key changes', async () => {
    const { fake, join } = setup([])
    fake.slots.refuseUndeclared = true
    const registry = new BlockRegistry()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')
    registry.registerBlock(alpha.ctx, meta('broken', 1, 'root'), Component)
    const register = fake.slots.register.bind(fake.slots)
    const attempts: (string | undefined)[] = []
    vi.spyOn(fake.slots, 'register').mockImplementation((options, component) => {
      attempts.push(options.id as string | undefined)
      if (options.id === 'broken') throw new Error('slot "webui.block.root" refused the entry')
      return register(options, component)
    })

    fake.slots.declare(ROOT_KEY)
    await microtask()
    for (const id of ['other-1', 'other-2', 'other-3']) {
      registry.registerBlock(alpha.ctx, meta(id, 2, 'root'), OTHER)
      await microtask()
    }

    expect(attempts.filter((id) => id === 'broken')).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0]).startsWith(LOG_PREFIX)).toBe(true)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['other-1', 'other-2', 'other-3'])
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['other-1', 'other-2', 'other-3'])
  })

  it('A3 of two same-id blocks waiting for the declaration the later one is rejected at once and only the first mounts', async () => {
    const { fake, join } = setup([])
    fake.slots.refuseUndeclared = true
    const registry = new BlockRegistry()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')
    const beta = await join('beta')

    registry.registerBlock(alpha.ctx, meta('dup', 1, 'root'), Component)
    const disposeSecond = registry.registerBlock(beta.ctx, meta('dup', 1, 'root'), OTHER)

    expect(registry.diagnostics()).toEqual([{ kind: 'duplicate-block', id: 'dup', kept: 'alpha', rejected: 'beta' }])
    disposeSecond()

    fake.slots.declare(ROOT_KEY)
    await microtask()

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['dup'])
    expect(fake.slots.entries(ROOT_KEY)[0]?.component).toBe(Component)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['dup'])
    expect(registry.blocks()[0]?.owner).toBe('alpha')
    expect(registry.diagnostics()).toHaveLength(1)
  })

  it('A4 once the first waiting block is disposed the id can be registered again and mounts after the declaration', async () => {
    const { fake, join } = setup([])
    fake.slots.refuseUndeclared = true
    const registry = new BlockRegistry()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')
    const beta = await join('beta')

    const disposeFirst = registry.registerBlock(alpha.ctx, meta('dup', 1, 'root'), Component)
    disposeFirst()
    registry.registerBlock(beta.ctx, meta('dup', 1, 'root'), OTHER)

    fake.slots.declare(ROOT_KEY)
    await microtask()

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['dup'])
    expect(fake.slots.entries(ROOT_KEY)[0]?.component).toBe(OTHER)
    expect(registry.blocks().map((block) => block.owner)).toEqual(['beta'])
    expect(registry.diagnostics()).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
  })

  it('A2 a block whose slot is declared up front enters it at once, and the two block keys stay independent', async () => {
    const { fake, join } = setup()
    fake.slots.refuseUndeclared = true
    fake.slots.declare(ROOT_KEY)
    fake.slots.declare(SESSION_KEY)
    const registry = new BlockRegistry()
    const alpha = await join('alpha')

    const disposeRoot = registry.registerBlock(alpha.ctx, meta('r1', 1, 'root'), Component)
    const disposeSession = registry.registerBlock(alpha.ctx, meta('s1', 2, 'session'), OTHER)

    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['r1'])
    expect(ids(fake.slots.entries(SESSION_KEY))).toEqual(['s1'])
    expect(fake.slots.entries(ROOT_KEY)[0]?.component).toBe(Component)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['r1', 's1'])
    expect(registry.diagnostics()).toHaveLength(0)
    expect(registry.remount('r1')).toBe(true)
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['r1'])

    disposeRoot()
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(ids(fake.slots.entries(SESSION_KEY))).toEqual(['s1'])
    disposeSession()
    expect(fake.slots.entries(SESSION_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
  })
})

describe('BlockRegistry ordering', () => {
  it('A2 compareByPriorityThenId orders by priority ascending, then by id in code-point order', () => {
    const sorted = [
      { id: 'b', priority: 1 },
      { id: 'a', priority: 1 },
      { id: 'late', priority: 2 },
      { id: 'early', priority: -3 },
      { id: 'B', priority: 1 },
    ]
      .sort(compareByPriorityThenId)
      .map((item) => item.id)
    expect(sorted).toEqual(['early', 'B', 'a', 'b', 'late'])

    // U+FFFF sorts before U+1F600 by code point, but after it by UTF-16 code unit.
    const astral = { id: 'z\u{1F600}', priority: 0 }
    const bmp = { id: 'z\uFFFF', priority: 0 }
    expect(compareByPriorityThenId(bmp, astral)).toBeLessThan(0)
    expect(compareByPriorityThenId(astral, bmp)).toBeGreaterThan(0)
    expect(compareByPriorityThenId(bmp, { ...bmp })).toBe(0)
  })

  it('A2 the same four blocks and three presets give the same order whatever the registration order', async () => {
    const blocks = [meta('beta', 20), meta('alpha', 20), meta('zero', 0), meta('ten', 10, 'session')]
    const presets = [preset('p-b', 5), preset('p-a', 5), preset('p-first', 1)]
    const orders = [
      { blocks: [0, 1, 2, 3], presets: [0, 1, 2] },
      { blocks: [3, 2, 1, 0], presets: [2, 1, 0] },
      { blocks: [2, 0, 3, 1], presets: [1, 2, 0] },
    ]

    const results: { blocks: string[]; presets: string[] }[] = []
    for (const order of orders) {
      const { join } = setup()
      const registry = new BlockRegistry()
      const alpha = await join('alpha')
      for (const index of order.blocks) {
        const block = blocks[index]
        if (block !== undefined) registry.registerBlock(alpha.ctx, block, Component)
      }
      for (const index of order.presets) {
        const entry = presets[index]
        if (entry !== undefined) registry.registerPreset(alpha.ctx, entry)
      }
      results.push({
        blocks: registry.blocks().map((block) => block.meta.id),
        presets: registry.presets().map((entry) => entry.id),
      })
    }

    for (const result of results) {
      expect(result.blocks).toEqual(['zero', 'ten', 'alpha', 'beta'])
      expect(result.presets).toEqual(['p-first', 'p-a', 'p-b'])
    }
  })

  it('A2 subscribed listeners are notified when blocks or presets change, and not after unsubscribing', async () => {
    const { join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)

    const disposeBlock = registry.registerBlock(alpha.ctx, meta('one'), Component)
    expect(listener).toHaveBeenCalledTimes(1)
    const disposePreset = registry.registerPreset(alpha.ctx, preset('one'))
    expect(listener).toHaveBeenCalledTimes(2)
    disposeBlock()
    expect(listener).toHaveBeenCalledTimes(3)
    disposePreset()
    expect(listener).toHaveBeenCalledTimes(4)

    unsubscribe()
    registry.registerBlock(alpha.ctx, meta('two'), Component)
    expect(listener).toHaveBeenCalledTimes(4)
  })
})

describe('BlockRegistry duplicate ids', () => {
  it('A3 a second registration of an id is rejected with a diagnostic and the first one stays', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')
    const beta = await join('beta')

    const disposeFirst = registry.registerBlock(alpha.ctx, meta('dup'), Component)
    let disposeSecond: () => void = () => {}
    expect(() => {
      disposeSecond = registry.registerBlock(beta.ctx, meta('dup'), OTHER)
    }).not.toThrow()

    expect(registry.blocks().map((block) => [block.meta.id, block.owner, block.component])).toEqual([
      ['dup', 'alpha', Component],
    ])
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['dup'])
    expect(registry.diagnostics()).toEqual([{ kind: 'duplicate-block', id: 'dup', kept: 'alpha', rejected: 'beta' }])
    expect(warn).toHaveBeenCalledTimes(1)

    disposeSecond()
    expect(registry.blocks().map((block) => block.owner)).toEqual(['alpha'])
    expect(ids(fake.slots.entries(ROOT_KEY))).toEqual(['dup'])

    // Once the first registration is gone the id is free again.
    disposeFirst()
    expect(registry.blocks()).toHaveLength(0)
    registry.registerBlock(beta.ctx, meta('dup'), OTHER)
    expect(registry.blocks().map((block) => block.owner)).toEqual(['beta'])
    expect(registry.diagnostics()).toHaveLength(1)
  })

  it('A3 a second preset with the same id is rejected the same way', async () => {
    const { join } = setup()
    const registry = new BlockRegistry()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const alpha = await join('alpha')
    const beta = await join('beta')

    registry.registerPreset(alpha.ctx, preset('dup', 1))
    const disposeSecond = registry.registerPreset(beta.ctx, preset('dup', 2))
    disposeSecond()

    expect(registry.presets().map((entry) => [entry.id, entry.priority])).toEqual([['dup', 1]])
    expect(registry.diagnostics()).toEqual([{ kind: 'duplicate-preset', id: 'dup', kept: 'alpha', rejected: 'beta' }])
  })
})

describe('BlockRegistry invalid input', () => {
  it('A4 an empty id or a non-finite priority throws TypeError and registers nothing', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    const listener = vi.fn()
    registry.subscribe(listener)

    const bad = [meta('', 1), meta('nan', Number.NaN), meta('inf', Number.POSITIVE_INFINITY), meta('', 1, 'session')]
    for (const candidate of bad) {
      expect(() => registry.registerBlock(alpha.ctx, candidate, Component)).toThrow(TypeError)
    }
    expect(() => registry.registerPreset(alpha.ctx, preset('', 1))).toThrow(TypeError)
    expect(() => registry.registerPreset(alpha.ctx, preset('nan', Number.NaN))).toThrow(TypeError)

    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(fake.slots.entries(SESSION_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
    expect(registry.presets()).toHaveLength(0)
    expect(registry.diagnostics()).toHaveLength(0)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('BlockRegistry remount', () => {
  it('A3 remount re-registers the entry through the same owner, once, and unloading the owner still removes it', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    registry.registerBlock(alpha.ctx, meta('X', 1), Component)
    registry.registerBlock(alpha.ctx, meta('Y', 2), OTHER)
    const beta = await join('beta')
    registry.registerBlock(beta.ctx, meta('B', 3), OTHER)
    const original = fake.slots.entries(ROOT_KEY).find((entry) => entry.options.id === 'X')

    expect(registry.remount('X')).toBe(true)

    const entries = fake.slots.entries(ROOT_KEY).filter((entry) => entry.options.id === 'X')
    expect(entries).toHaveLength(1)
    expect(entries[0]).not.toBe(original)
    expect(entries[0]?.component).toBe(Component)
    expect(entries[0]?.options.priority).toBe(1)
    expect(ids(fake.slots.entries(ROOT_KEY)).sort()).toEqual(['B', 'X', 'Y'])
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['X', 'Y', 'B'])
    expect(registry.blocks().map((block) => block.owner)).toEqual(['alpha', 'alpha', 'beta'])

    await beta.unload()
    expect(ids(fake.slots.entries(ROOT_KEY)).sort()).toEqual(['X', 'Y'])
    await alpha.unload()
    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
  })

  it('A3 a disposer called after remount still removes the block and its new entry', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    const dispose = registry.registerBlock(alpha.ctx, meta('X'), Component)

    registry.remount('X')
    dispose()

    expect(fake.slots.entries(ROOT_KEY)).toHaveLength(0)
    expect(registry.blocks()).toHaveLength(0)
  })

  it('A3 remount of an id that was not registered through registerBlock returns false and changes nothing', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    registry.registerBlock(alpha.ctx, meta('X'), Component)
    const foreign = alpha.ctx.slots.register({ name: ROOT_KEY, id: 'F' }, OTHER)
    const entries = [...fake.slots.entries(ROOT_KEY)]

    expect(registry.remount('F')).toBe(false)
    expect(registry.remount('nope')).toBe(false)

    expect(fake.slots.entries(ROOT_KEY)).toEqual(entries)
    expect(fake.slots.entries(ROOT_KEY).every((entry, index) => entry === entries[index])).toBe(true)
    expect(registry.blocks().map((block) => block.meta.id)).toEqual(['X'])
    foreign()
  })
})

describe('BlockRegistry session inject', () => {
  /** The message of the Error `run` throws; fails when it throws nothing or not an Error. */
  function errorMessage(run: () => void): string {
    try {
      run()
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      return error instanceof Error ? error.message : ''
    }
    throw new Error('expected an error')
  }

  it('A1 a session block is registered as a bridge whose inject reads the current session factory', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    // 'note-9' is not a substring of LOG_PREFIX or "sessions service", so the message check is the block id.
    registry.registerBlock(alpha.ctx, meta('note-9', 1, 'session'), Component)

    const slots: FakeSlots = fake.slots
    const entry = slots.entries(SESSION_KEY)[0]
    expect(entry?.component).not.toBe(Component)
    expect(typeof entry?.component).toBe('function')
    const inject = entry?.options.inject
    expect(typeof inject).toBe('function')
    if (typeof inject !== 'function') throw new Error('the session entry has no inject')
    const call = inject as (sessionId: string) => WebuiSessionInject

    const unset = errorMessage(() => {
      call('s1')
    })
    expect(unset).toContain(LOG_PREFIX)
    expect(unset).toContain('note-9')
    expect(unset).toContain('sessions service')

    const forS1 = { marker: 's1' } as unknown as WebuiSessionInject
    const forS2 = { marker: 's2' } as unknown as WebuiSessionInject
    const factory = vi.fn((sessionId: string): WebuiSessionInject => (sessionId === 's2' ? forS2 : forS1))
    registry.setSessionInject(factory)

    expect(call('s1')).toBe(forS1)
    expect(call('s2')).toBe(forS2)
    expect(factory.mock.calls).toEqual([['s1'], ['s2']])

    registry.setSessionInject(undefined)
    const cleared = errorMessage(() => {
      call('s1')
    })
    expect(cleared).toContain(LOG_PREFIX)
    expect(cleared).toContain('note-9')
    expect(cleared).toContain('sessions service')
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('A2 a root block enters its slot as the contributor function component itself, without inject', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')

    registry.registerBlock(alpha.ctx, meta('r1', 1, 'root'), Component)

    const slots: FakeSlots = fake.slots
    const entry = slots.entries(ROOT_KEY)[0]
    expect(entry?.component).toBe(Component)
    expect(entry?.options.inject).toBeUndefined()
  })

  it('A5 registry.remount re-registers the same session wrapper and the same inject exactly once', async () => {
    const { fake, join } = setup()
    const registry = new BlockRegistry()
    const alpha = await join('alpha')
    const slots: FakeSlots = fake.slots
    const register = vi.spyOn(slots, 'register')

    registry.registerBlock(alpha.ctx, meta('pane-1', 1, 'session'), Component)
    const registeredCalls = register.mock.calls.length
    const first = slots.entries(SESSION_KEY)[0]
    expect(first?.component).not.toBe(Component)
    expect(typeof first?.options.inject).toBe('function')

    expect(registry.remount('pane-1')).toBe(true)

    expect(register).toHaveBeenCalledTimes(registeredCalls + 1)
    const next = slots.entries(SESSION_KEY)
    expect(next).toHaveLength(1)
    expect(next[0]).not.toBe(first)
    expect(next[0]?.component).toBe(first?.component)
    expect(next[0]?.options.inject).toBe(first?.options.inject)
  })
})
