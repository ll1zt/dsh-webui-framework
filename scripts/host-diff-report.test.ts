import { describe, expect, it } from 'vitest'
import { renderDiff } from './host-diff.ts'
import type { HostDiffReport } from './host-diff.ts'
import type { Unverified } from './unverified.ts'

const report: HostDiffReport = {
  entries: [
    { entry: '@deepseek-ai/cordis', files: [], changed: false },
    {
      entry: '@deepseek-ai/dsh-api-session-controller',
      files: ['src/client/services/session-adapter.ts'],
      changed: true,
    },
  ],
  patchAdded: ['added-row'],
  patchRemoved: ['removed-row'],
  patchUnchanged: false,
}

/** Byte-identical output of renderDiff before an unverified list is supplied. */
const EXPECTED = `## 宿主差异

- @deepseek-ai/cordis：无变化（framework-wide）
- @deepseek-ai/dsh-api-session-controller：src/client/services/session-adapter.ts

## 装配表（patch）

新增：
- added-row
删除：
- removed-row
`

const bulletsOf = (markdown: string): string[] => markdown.split('\n').filter((line) => line.startsWith('- '))

describe('renderDiff unverified section', () => {
  it('A3 renderDiff without unverified items keeps the host-diff paragraph byte-identical', () => {
    expect(renderDiff(report)).toBe(EXPECTED)
    expect(renderDiff(report, [])).toBe(EXPECTED)
    expect(renderDiff(report)).not.toContain('未验证的结论')
  })

  it('A3 renderDiff appends manual unverified ids and a one-line summary', () => {
    const items: readonly Unverified[] = [
      { id: '2', text: '快照引用保持稳定', check: 'session-adapter.test.ts' },
      { id: '5', text: '在途 prompt 的 Promise 落定', check: 'manual' },
    ]
    const text = renderDiff(report, items)
    expect(text.startsWith(EXPECTED)).toBe(true)
    const extra = text.slice(EXPECTED.length)
    expect(extra.startsWith('## 未验证的结论\n')).toBe(true)
    expect(bulletsOf(extra)).toEqual([
      '- 2. 快照引用保持稳定: session-adapter.test.ts',
      '- 5. 在途 prompt 的 Promise 落定: 需人工复核',
    ])
  })
})
