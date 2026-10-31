import { describe, expect, it } from 'vitest'
import { localizedTextFor } from './localized-text.ts'

describe('localizedTextFor', () => {
  it('A1 a regional language falls back to its primary tag', () => {
    expect(localizedTextFor({ en: 'Hello', zh: '你好' }, 'zh-CN')).toBe('你好')
  })

  it('A1 an exact language key wins over the primary tag', () => {
    expect(localizedTextFor({ en: 'Hello', 'zh-TW': '妳好', zh: '你好' }, 'zh-TW')).toBe('妳好')
  })

  it('A1 any language tag can be written, not only zh and en', () => {
    expect(localizedTextFor({ en: 'Hi', fr: 'Salut' }, 'fr-FR')).toBe('Salut')
  })

  it('A1 a language with no key falls back to en', () => {
    expect(localizedTextFor({ en: 'Hi', zh: '嗨' }, 'de')).toBe('Hi')
  })

  it('A1 the primary tag is looked up in lower case', () => {
    expect(localizedTextFor({ en: 'Hi', fr: 'Salut' }, 'FR-ca')).toBe('Salut')
  })
})
