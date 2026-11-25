/** Shortcuts feature: registers the layout commands (close, switch tab or pane, undo, redo) on the host's `shortcuts` service. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import type {
  ShortcutBinding,
  ShortcutCommand,
  ShortcutCommandId,
  ShortcutContext,
} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutProfile } from '@deepseek-ai/dsh-client-shortcuts/protocol'
import { LAYOUT_COMMAND_IDS, planLayoutCommand, type LayoutCommandId } from '../../lib/layout-commands.ts'
import { focusActiveTab, panePathOfElement } from '../../ui/shell/pane-dom.ts'
import type { Dock } from '../services/dock-state.ts'
import type { LayoutController } from '../services/layout-controller.ts'
import { LOG_PREFIX } from '../services/log-prefix.ts'
import type { WebuiTranslate } from '../types.ts'
import type { WebuiFeature } from './index.ts'

type ShortcutResolution = ReturnType<ShortcutCommand['resolve']>
/** The copy key of a command's label. */
type ShortcutLabelKey = Parameters<WebuiTranslate>[0]

const PROFILES: readonly ShortcutProfile[] = [
  'web:macos',
  'web:windows',
  'web:linux',
  'desktop:macos',
  'desktop:windows',
  'desktop:linux',
]

const PRIMARY_ALT = ['primary', 'alt'] as const

/** A command id without its package prefix: the key of the tables below and of the label copy. */
type CommandName = LayoutCommandId extends `${string}.${infer Name}` ? Name : never

/** The default key of each command by name; it is the same in every profile, so tsc checks the table is complete. */
const BINDINGS: Record<CommandName, ShortcutBinding> = {
  'tab.close': { code: 'KeyW', modifiers: PRIMARY_ALT },
  'tab.next': { code: 'BracketRight', modifiers: PRIMARY_ALT },
  'tab.previous': { code: 'BracketLeft', modifiers: PRIMARY_ALT },
  'pane.next': { code: 'Period', modifiers: PRIMARY_ALT },
  'pane.previous': { code: 'Comma', modifiers: PRIMARY_ALT },
  'layout.undo': { code: 'KeyZ', modifiers: PRIMARY_ALT },
  'layout.redo': { code: 'KeyZ', modifiers: [...PRIMARY_ALT, 'shift'] },
}

const nameOf = (id: LayoutCommandId): CommandName => id.split('.').slice(1).join('.') as CommandName

/**
 * Build one command: where it applies and how a key press becomes a layout action. A rejected action (a tab that
 * cannot close, a vetoing guard) is ignored without a trace.
 * @param id - the command to build.
 * @param controller - the page's layout controller.
 * @param label - the command's name in the current language.
 * @returns the command as the host's shortcuts service takes it.
 */
function commandOf(id: LayoutCommandId, controller: LayoutController, label: () => string): ShortcutCommand {
  const name = nameOf(id)
  const history = name === 'layout.undo' || name === 'layout.redo'
  const defaults: Partial<Record<ShortcutProfile, ShortcutBinding>> = {}
  for (const profile of PROFILES) defaults[profile] = BINDINGS[name]
  const { view, actions } = controller

  function resolve(context: ShortcutContext): ShortcutResolution {
    const step = planLayoutCommand(view.getSnapshot(), id, panePathOfElement(context.target))
    if (step === undefined) return { status: 'pass' }
    if (step.kind === 'undo' && !view.canUndo()) return { status: 'pass' }
    if (step.kind === 'redo' && !view.canRedo()) return { status: 'pass' }
    return {
      status: 'handled',
      run: () => {
        switch (step.kind) {
          case 'close':
            actions.close(step.target)
            break
          case 'activate':
            actions.activate(step.target)
            requestAnimationFrame(() => focusActiveTab(document, step.pane))
            break
          case 'undo':
            actions.undo()
            break
          case 'redo':
            actions.redo()
            break
        }
      },
    }
  }

  return {
    id: id as string as ShortcutCommandId,
    label,
    aliases: [],
    defaults,
    regions: history ? ['page'] : ['page', 'editable'],
    modals: [],
    resolve,
  }
}

/**
 * Register the seven layout commands once the host's `shortcuts` service exists. The service is waited for with
 * `ctx.inject`, never listed in the feature's `inject`, so without it the page starts and no command exists. A
 * command the service refuses (duplicate id, clashing default key) is warned about and skipped.
 * @param ctx - client root context.
 * @param dock - shared dock for this page.
 */
function apply(ctx: Context, dock: Dock): void {
  const { controller } = dock
  const t = ctx.locale.bind('webui')

  ctx.inject(['shortcuts'], (ctx) => {
    for (const id of LAYOUT_COMMAND_IDS) {
      const command = commandOf(id, controller, () => t(`shortcut.${nameOf(id)}` as ShortcutLabelKey))
      ctx.effect(() => {
        try {
          return ctx.shortcuts.register(command)
        } catch (error) {
          console.warn(`${LOG_PREFIX} could not register the shortcut ${id}: ${String(error)}`)
          return () => {}
        }
      }, `webui: shortcut ${id}`)
    }
  })
}

export const shortcuts: WebuiFeature = { name: 'shortcuts', inject: ['locale'], apply }
