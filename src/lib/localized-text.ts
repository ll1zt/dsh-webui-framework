/** Picks the text of a `LocalizedText` for a language tag. */
import type { LocalizedText } from '@lllzt/dsh-webui-framework/contract'

/**
 * The text for `language`: the key equal to it as written, else the key of its primary subtag
 * (before the first '-', lower-cased), else `en`.
 */
export function localizedTextFor(text: LocalizedText, language: string): string {
  const own = (key: string): string | undefined => (Object.hasOwn(text, key) ? text[key] : undefined)
  return own(language) ?? own(language.split('-')[0]!.toLowerCase()) ?? text.en
}
