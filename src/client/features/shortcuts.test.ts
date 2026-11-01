// @vitest-environment happy-dom
import { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommand, ShortcutContext } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { BlockMeta, LayoutNode, WebuiLayout } from '@lllzt/dsh-webui-framework/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import en from '../../../locale/en.json'
import zh from '../../../locale/zh.json'
import { LAYOUT_COMMAND_IDS } from '../../lib/layout-commands.ts'
import { createFakeContext, type FakeContext } from '../../test/fake-ctx.ts'
import { dockOf } from '../services/dock-state.ts'
import { LOG_PREFIX } from '../services/log-prefix.ts'
import { shortcuts } from './shortcuts.ts'

/** A shortcuts service that only records `register`; it throws for the id in `refuse`. */
function fakeShortcuts(refuse?: string) {
  const commands: ShortcutCommand[] = []
  const disposers = new Map<string, ReturnType<typeof vi.fn>>()
  const register = vi.fn((command: ShortcutCommand) => {
    if (command.id === refuse) throw new Error('id already registered')
    const dispose = vi.fn()
    commands.push(command)
    disposers.set(command.id, dispose)
    return dispose
  })
  return { register, commands, disposers }
}

const FR = { fr: 1 } as const
const pane = (active: number, ...ids: string[]): LayoutNode => ({
  kind: 'pane',
  tabs: ids.map((blockId) => ({ blockId, contentId: '' })),
  active,
})
const twoPanes: WebuiLayout = {
  version: 1,
  root: { kind: 'split', axis: 'row', children: [pane(0, 'a', 'b'), pane(0, 'c', 'd')], sizes: [FR, FR] },
  activePane: [0],
}

/** The page with the feature applied, and a registered block per id. */
async function setup(layout: WebuiLayout | null, closable: Record<string, boolean> = {}, refuse?: string) {
  const service = fakeShortcuts(refuse)
  const ctx = createFakeContext({ shortcuts: service })
  ctx.slots.declare('webui.block.root')
  ctx.slots.declare('webui.block.session')
  const host = new Context()
  host.provide('slots', ctx.slots)
  const owners: Context[] = []
  await host.plugin({ name: 'alpha', apply: (owner: Context) => void owners.push(owner) })
  const owner = owners[0]
  if (owner === undefined) throw new Error('contributor alpha did not start')
  const { controller, registry } = dockOf(ctx)
  for (const id of ['a', 'b', 'c', 'd']) {
    const meta: BlockMeta = {
      id,
      scope: 'root',
      priority: 0,
      title: { zh: id, en: id },
      closable: closable[id] ?? true,
      multiInstance: false,
    }
    registry.registerBlock(owner, meta, () => null)
  }
  controller.replaceLayout(layout ?? { version: 1, root: null, activePane: [] }, true)
  ctx.plugin(shortcuts)
  const command = (id: string): ShortcutCommand => {
    const found = service.commands.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`${id} was not registered`)
    return found
  }
  return { ctx, service, controller, command }
}

const page = (target: Element | null = null): ShortcutContext => ({ region: 'page', modal: null, target })

function run(command: ShortcutCommand, target: Element | null = null): void {
  const resolution = command.resolve(page(target))
  if (resolution.status !== 'handled') throw new Error(`${command.id} did not handle: ${resolution.status}`)
  resolution.run()
}

/** Two pane elements with a selected tab button and a text area each, as the dock draws them. */
function mountPanes() {
  const make = (path: string) => {
    const element = document.createElement('div')
    element.setAttribute('data-webui-pane', path)
    element.innerHTML = '<button role="tab" aria-selected="true">tab</button><textarea></textarea>'
    document.body.append(element)
    return element
  }
  const first = make('0')
  const second = make('1')
  return [first, second] as const
}

function tabsOf(layout: WebuiLayout): string[][] {
  const panes = layout.root?.kind === 'split' ? layout.root.children : layout.root === null ? [] : [layout.root]
  return panes.map((node) => (node.kind === 'pane' ? node.tabs.map((tab) => tab.blockId) : []))
}

function activesOf(layout: WebuiLayout): number[] {
  const panes = layout.root?.kind === 'split' ? layout.root.children : layout.root === null ? [] : [layout.root]
  return panes.map((node) => (node.kind === 'pane' ? node.active : -1))
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('shortcuts feature', () => {
  it('A1 registers exactly the seven layout commands in order, labelled in the current language', async () => {
    const { ctx, service } = await setup(null)
    ctx.locale.register('webui', { zh, en })

    expect(service.register).toHaveBeenCalledTimes(7)
    expect(service.commands.map((command) => command.id)).toEqual([...LAYOUT_COMMAND_IDS])
    expect(service.commands.map((command) => command.label())).toEqual([
      '关闭当前标签',
      '下一个标签',
      '上一个标签',
      '下一个格子',
      '上一个格子',
      '撤销布局改动',
      '重做布局改动',
    ])

    const english: FakeContext = createFakeContext({
      shortcuts: fakeShortcuts(),
      locale: { bind: () => (key: string) => (en as Record<string, string>)[key] ?? key },
    })
    english.plugin(shortcuts)
    const labels = (english.shortcuts as unknown as ReturnType<typeof fakeShortcuts>).commands.map((command) =>
      command.label(),
    )
    expect(labels).toEqual([
      'Close current tab',
      'Next tab',
      'Previous tab',
      'Next pane',
      'Previous pane',
      'Undo layout change',
      'Redo layout change',
    ])
  })

  it('A2 every command has the same default key in all six profiles, and its regions, modals and aliases', async () => {
    const { service } = await setup(null)
    const primaryAlt = ['primary', 'alt']
    const keys: Record<string, { code: string; modifiers: string[] }> = {
      'webui.tab.close': { code: 'KeyW', modifiers: primaryAlt },
      'webui.tab.next': { code: 'BracketRight', modifiers: primaryAlt },
      'webui.tab.previous': { code: 'BracketLeft', modifiers: primaryAlt },
      'webui.pane.next': { code: 'Period', modifiers: primaryAlt },
      'webui.pane.previous': { code: 'Comma', modifiers: primaryAlt },
      'webui.layout.undo': { code: 'KeyZ', modifiers: primaryAlt },
      'webui.layout.redo': { code: 'KeyZ', modifiers: ['primary', 'alt', 'shift'] },
    }
    const profiles = ['web:macos', 'web:windows', 'web:linux', 'desktop:macos', 'desktop:windows', 'desktop:linux']

    expect(service.commands).toHaveLength(7)
    for (const command of service.commands) {
      const expected = keys[command.id]
      expect(Object.keys(command.defaults).sort()).toEqual([...profiles].sort())
      for (const profile of profiles) {
        const binding = (command.defaults as Record<string, { code: string; modifiers: string[] }>)[profile]
        expect(binding?.code).toBe(expected?.code)
        expect([...(binding?.modifiers ?? [])].sort()).toEqual([...(expected?.modifiers ?? [])].sort())
      }
      const history = command.id === 'webui.layout.undo' || command.id === 'webui.layout.redo'
      expect(command.regions).toEqual(history ? ['page'] : ['page', 'editable'])
      expect(command.modals).toEqual([])
      expect(command.aliases).toEqual([])
    }
  })

  it('A3 the pane holding the target is the current one, the active pane is used without a target', async () => {
    const { command, controller } = await setup(twoPanes)
    const [, second] = mountPanes()

    run(command('webui.tab.next'), second.querySelector('textarea'))
    expect(activesOf(controller.view.getSnapshot())).toEqual([0, 1])

    const bare = await setup(twoPanes)
    run(bare.command('webui.tab.next'), null)
    expect(activesOf(bare.controller.view.getSnapshot())).toEqual([1, 0])
  })

  it('A3 passes when there is nothing to do: empty layout, a lone tab, nothing to undo or redo', async () => {
    const empty = await setup(null)
    for (const id of LAYOUT_COMMAND_IDS) expect(empty.command(id).resolve(page())).toEqual({ status: 'pass' })

    const lone = await setup({ version: 1, root: pane(0, 'a'), activePane: [] })
    expect(lone.command('webui.tab.next').resolve(page())).toEqual({ status: 'pass' })

    const fresh = await setup(twoPanes)
    expect(fresh.command('webui.layout.undo').resolve(page())).toEqual({ status: 'pass' })
    expect(fresh.command('webui.layout.redo').resolve(page())).toEqual({ status: 'pass' })
    expect(fresh.command('webui.tab.next').resolve(page()).status).toBe('handled')
  })

  it('A4 close shuts the current tab; undo takes it back and each command is one user action', async () => {
    const { command, controller } = await setup(twoPanes)
    const heard = vi.fn()
    controller.onAction(heard)
    const before = controller.view.getSnapshot()

    run(command('webui.tab.close'))
    expect(tabsOf(controller.view.getSnapshot())).toEqual([['b'], ['c', 'd']])
    expect(heard).toHaveBeenCalledTimes(1)

    expect(controller.actions.undo()).toEqual({ ok: true })
    expect(controller.view.getSnapshot()).toEqual(before)
    heard.mockClear()

    run(command('webui.tab.next'))
    expect(activesOf(controller.view.getSnapshot())).toEqual([1, 0])
    expect(heard).toHaveBeenCalledTimes(1)
    expect(controller.actions.undo()).toEqual({ ok: true })
    expect(controller.view.getSnapshot()).toEqual(before)
  })

  it('A4 a tab that is not closable or whose guard refuses stays: no throw, no change, no log', async () => {
    const warn = vi.spyOn(console, 'warn')
    const error = vi.spyOn(console, 'error')
    const fixed = await setup(twoPanes, { a: false })
    const fixedHeard = vi.fn()
    fixed.controller.onAction(fixedHeard)
    const fixedBefore = fixed.controller.view.getSnapshot()
    expect(() => run(fixed.command('webui.tab.close'))).not.toThrow()
    expect(fixed.controller.view.getSnapshot()).toBe(fixedBefore)
    expect(fixedHeard).not.toHaveBeenCalled()

    const guarded = await setup(twoPanes)
    guarded.controller.actions.setCloseGuard({ blockId: 'a', contentId: '' }, () => false)
    const guardedBefore = guarded.controller.view.getSnapshot()
    expect(() => run(guarded.command('webui.tab.close'))).not.toThrow()
    expect(guarded.controller.view.getSnapshot()).toBe(guardedBefore)

    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
  })

  it('A5 pane.next activates the next pane and focuses its active tab button on the next animation frame', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame'] })
    const { command, controller } = await setup(twoPanes)
    const [first, second] = mountPanes()
    const input = first.querySelector('textarea')
    input?.focus()

    run(command('webui.pane.next'), input)
    expect(controller.view.getSnapshot().activePane).toEqual([1])
    expect(document.activeElement).toBe(input)

    vi.advanceTimersToNextFrame()
    expect(document.activeElement).toBe(second.querySelector('[role="tab"]'))
  })

  it('A6 without a shortcuts service nothing is registered and nothing throws', () => {
    const warn = vi.spyOn(console, 'warn')
    const ctx = createFakeContext()
    expect(() => ctx.plugin(shortcuts)).not.toThrow()
    expect(ctx.activePlugins).toContain('shortcuts')
    expect(warn).not.toHaveBeenCalled()
    ctx.disposeAll()
  })

  it('A6 a command the service refuses is warned about once and the other six are registered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { service } = await setup(null, {}, 'webui.tab.next')

    expect(service.register).toHaveBeenCalledTimes(7)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = warn.mock.calls[0]?.join(' ') ?? ''
    expect(message).toContain('webui.tab.next')
    expect(message).toContain(LOG_PREFIX)
    expect(service.commands.map((command) => command.id)).toEqual(
      LAYOUT_COMMAND_IDS.filter((id) => id !== 'webui.tab.next'),
    )
  })

  it('A6 disposing the framework context unregisters all seven commands', async () => {
    const { ctx, service } = await setup(null)
    expect(service.disposers.size).toBe(7)
    for (const dispose of service.disposers.values()) expect(dispose).not.toHaveBeenCalled()

    ctx.disposeAll()
    for (const dispose of service.disposers.values()) expect(dispose).toHaveBeenCalledTimes(1)
  })
})
