/** Module augmentations for slot keys and session-scoped standard props (docs/03 §2.3). */
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
