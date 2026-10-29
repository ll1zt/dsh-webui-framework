/** Module augmentations for slot keys and session-scoped standard props. */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type zhDict from '../../locale/zh.json'

/**
 * Copy keys of this package's `webui` locale namespace. Taking them from the zh
 * dictionary makes the en dictionary and the registration site type-check
 * against the same key set, so the two locales cannot drift apart silently.
 */
type WebuiKey = keyof typeof zhDict

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This package's own copy (locale/*.json). */
    webui: WebuiKey
  }
}

/** Copy function of this package's `webui` namespace: the only place its type is spelled, so a wrong key fails tsc. */
export type WebuiTranslate = TranslateNS<'webui'>

/** Slot keys of the block lists, by block scope: the only place the `webui.block.*` names are spelled. */
export const WEBUI_SLOT_KEYS = { root: 'webui.block.root', session: 'webui.block.session' } as const

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Blocks of `root` scope: additive list the shell renders in the workspace. */
    'webui.block.root': { kind: 'list'; scope: 'root' }
    /** Blocks of `session` scope: additive list rendered inside the session area. */
    'webui.block.session': { kind: 'list'; scope: 'session' }
  }
}
