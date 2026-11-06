import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readUnverified, UNVERIFIED_CHECKS, unverifiedSection } from './unverified.ts'
import type { Unverified } from './unverified.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SPIKE = join(ROOT, 'docs/spikes/session-adapter.md')
const UNVERIFIED_DOC = join(ROOT, 'docs/unverified.md')

/** Item text from the spike, with the leading `N. ` already removed. */
const TEXTS: Record<string, string> = {
  '1': '`ctx.sessions.binding(sessionId)` 在条目 `inject` 运行时一定返回当前世代的绑定（读源码得知，依据是条目只在有 scope binding 时渲染）。',
  '2': '派生状态源的 `getSnapshot` 稳定性满足 uSES，块不会出现撕裂或无限重渲染（读 `bind.ts` 得知）。',
  '3': '主会话切换时 session 条目恰好重挂一次（`docs/research/alpha2-facts.local.md` §7 同源；本文没有重测）。',
  '4': "`'queue'` 模式在会话运行中追加的行为，与 `cancel()` 在空闲时的答复。",
  '5': '`prompt` 在途时世代被拆掉，Promise 怎样落定。',
  '6': '空白文本被宿主拒绝并写进 `promptError`（本文只依据类型注释）。',
  '7': "框架代贡献者的组件做 `inject`（`hooks` 隔间加一个动作对象）在 `webui.block.session` 这个 `list` 槽位上可用。宿主里“session 作用域的 `list` 槽位 + 条目 `inject` 返回 `hooks`”有先例：`conversation.view` 在 `ref/deepseek-harness/packages/client/ui-conversation/src/client/apply.ts:396` 声明为 `{ kind: 'list', scope: 'session' }`，`ui-trajectory` 往里注册的条目 `inject(sessionId)` 返回 `hooks: { duration }`（`ref/deepseek-harness/packages/client/ui-trajectory/src/client/index.ts:85-97`）。差别是那里的 `inject` 由组件所属插件写，我们是框架替贡献者的组件写。U3 先写一个最小用例确认；如果不成立，退路是 R2，适配器内部换路，契约不变。",
}

const IDS = ['1', '2', '3', '4', '5', '6', '7']

const CHECKS = ['session-adapter.test.ts', 'manual'] as const

/** `### <id>. <title>` sections, in document order. The body includes its heading. */
const sectionsOf = (doc: string): { id: string; body: string }[] => {
  const headings = [...doc.matchAll(/^### (\d+)\. (.+)$/gm)]
  return headings.map((match, index) => {
    const start = match.index ?? 0
    const end = headings[index + 1]?.index ?? doc.length
    return { id: match[1] ?? '', body: doc.slice(start, end) }
  })
}

describe('readUnverified', () => {
  it('A1 readUnverified returns the seven spike conclusions with ids 1 through 7 and non-empty text', () => {
    const items = readUnverified(readFileSync(SPIKE, 'utf8'))
    expect(items).toEqual(
      IDS.map((id) => ({
        id,
        text: TEXTS[id],
        check: UNVERIFIED_CHECKS[id] ?? 'manual',
      })),
    )
    for (const item of items) {
      expect(item.text.trim(), item.id).not.toBe('')
      expect(CHECKS, item.id).toContain(item.check)
    }
  })

  it('A1 readUnverified ignores numbered lists outside the unverified section', () => {
    const sample = [
      '## 未在宿主上验证的结论',
      '',
      '1. 二级标题下的编号不算',
      '',
      '### 其他',
      '',
      '1. 其他小节的编号不算',
      '2. 第二条也不算',
      '',
      '### 未在宿主上验证的结论',
      '',
      '1. 绑定在 inject 时返回当前世代   ',
      '2. 空白文本写入 promptError',
      '',
      '### 后记',
      '',
      '1. 后记的编号不算',
    ].join('\n')

    expect(readUnverified(sample)).toEqual([
      {
        id: '1',
        text: '绑定在 inject 时返回当前世代',
        check: UNVERIFIED_CHECKS['1'] ?? 'manual',
      },
      {
        id: '2',
        text: '空白文本写入 promptError',
        check: UNVERIFIED_CHECKS['2'] ?? 'manual',
      },
    ])
    expect(readUnverified('### 其他\n\n1. 只有别的编号\n')).toEqual([])
    expect(readUnverified('### 未在宿主上验证的结论\n\n8. 表里没有的一条\n')).toEqual([
      { id: '8', text: '表里没有的一条', check: 'manual' },
    ])
  })
})

describe('unverifiedSection', () => {
  it('A1 unverifiedSection renders （无） for an empty list and one bullet per item', () => {
    expect(unverifiedSection([]).trim()).toBe('（无）')
    const items: Unverified[] = [
      { id: '2', text: '快照引用保持稳定', check: 'session-adapter.test.ts' },
      { id: '4', text: 'queue 模式在运行中追加', check: 'manual' },
    ]
    expect(unverifiedSection(items).trim().split('\n')).toEqual([
      '- 2. 快照引用保持稳定: session-adapter.test.ts',
      '- 4. queue 模式在运行中追加: 需人工复核',
    ])
  })
})

describe('docs/unverified.md', () => {
  it('A2 docs/unverified.md has a recheck section for each id with a command, an expected result, and the rc.1 DSH_HOME', () => {
    expect(existsSync(UNVERIFIED_DOC), UNVERIFIED_DOC).toBe(true)
    const doc = existsSync(UNVERIFIED_DOC) ? readFileSync(UNVERIFIED_DOC, 'utf8') : ''
    const sections = sectionsOf(doc)
    expect(sections.map((section) => section.id)).toEqual(IDS)
    for (const section of sections) {
      expect(section.body, section.id).toMatch(/node |npm |nix develop/)
      expect(section.body, section.id).toContain('/home/agent/dev/dsh-rc1/home')
      expect(section.body, section.id).toContain('预期')
    }
  })
})
