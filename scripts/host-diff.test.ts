import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { compareHost, renderDiff } from './host-diff.ts'
import type { HostDiffReport } from './host-diff.ts'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/host-diff')
const BASE = join(FIXTURES, 'base')
const NEXT = join(FIXTURES, 'next')

/** Fixed entry table: framework-wide entries have no single repo file. */
const ENTRIES: { entry: string; files: readonly string[] }[] = [
  { entry: '@deepseek-ai/cordis', files: [] },
  { entry: '@deepseek-ai/dsh-api-session-controller', files: ['src/client/services/session-adapter.ts'] },
  { entry: '@deepseek-ai/dsh-client-locale', files: ['src/client/features/shell.ts'] },
  { entry: '@deepseek-ai/dsh-client-shortcuts', files: ['src/client/features/shortcuts.ts'] },
  { entry: '@deepseek-ai/dsh-client-store', files: [] },
  { entry: '@deepseek-ai/dsh-client-ui-renderer', files: ['src/client/features/shell.ts'] },
  { entry: '@deepseek-ai/dsh-client-ui-settings', files: ['src/client/features/layout.ts'] },
  { entry: '@deepseek-ai/dsh-client-ui-slots', files: ['src/client/services/block-registry.ts'] },
  { entry: '@deepseek-ai/dsh-client-ui-theme', files: ['src/client/services/theme-presenter.ts'] },
  { entry: '@deepseek-ai/schemastery', files: [] },
]

const SESSION = '@deepseek-ai/dsh-api-session-controller'
const SHORTCUTS = '@deepseek-ai/dsh-client-shortcuts'

const shape = (report: HostDiffReport) =>
  report.entries.map((item) => ({ entry: item.entry, files: [...item.files], changed: item.changed }))

/** Lines of one entry, from its name through the line before the next entry name. */
const blockOf = (markdown: string, entry: string): string => {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => line.includes(entry))
  expect(start, entry).toBeGreaterThanOrEqual(0)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (ENTRIES.some((item) => item.entry !== entry && line.includes(item.entry))) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

const expectProse = (markdown: string, changed: ReadonlySet<string>) => {
  for (const item of ENTRIES) {
    const block = blockOf(markdown, item.entry)
    if (changed.has(item.entry)) {
      expect(block, item.entry).not.toContain('无变化')
      for (const file of item.files) expect(block, item.entry).toContain(file)
    } else {
      expect(block, item.entry).toContain('无变化')
    }
    if (item.files.length === 0) expect(block, item.entry).toContain('framework-wide')
    else expect(block, item.entry).not.toContain('framework-wide')
  }
}

const withBaseCopy = (run: (root: string) => void, mutate?: (root: string) => void) => {
  const root = mkdtempSync(join(tmpdir(), 'host-diff-'))
  try {
    cpSync(BASE, root, { recursive: true })
    mutate?.(root)
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe('compareHost', () => {
  it('A1 identical fixture trees leave every entry unchanged and render 无变化', () => {
    withBaseCopy((copy) => {
      const report = compareHost(BASE, copy)
      expect(shape(report)).toEqual(
        ENTRIES.map((item) => ({ entry: item.entry, files: [...item.files], changed: false })),
      )
      expect([...report.patchAdded]).toEqual([])
      expect([...report.patchRemoved]).toEqual([])
      expect(report.patchUnchanged).toBe(true)
      const text = renderDiff(report)
      expectProse(text, new Set())
      expect(text).toMatch(/patch|装配表/)
      expect(text).not.toContain('added-row')
      expect(text).not.toContain('removed-row')
    })
  })

  it('A2 a changed session-controller d.ts and a patch row mark that entry, its repo file, and the added and removed ids', () => {
    const report = compareHost(BASE, NEXT)
    expect(shape(report)).toEqual(
      ENTRIES.map((item) => ({
        entry: item.entry,
        files: [...item.files],
        changed: item.entry === SESSION,
      })),
    )
    expect([...report.patchAdded]).toEqual(['added-row'])
    expect([...report.patchRemoved]).toEqual(['removed-row'])
    expect(report.patchUnchanged).toBe(false)
    const text = renderDiff(report)
    expectProse(text, new Set([SESSION]))
    expect(text).toContain('added-row')
    expect(text).toContain('removed-row')
  })

  it('A2 a missing package directory on the next side marks that entry changed', () => {
    const expected = ENTRIES.map((item) => ({
      entry: item.entry,
      files: [...item.files],
      changed: item.entry === SHORTCUTS,
    }))
    withBaseCopy((copy) => {
      rmSync(join(copy, 'node_modules', SHORTCUTS), { recursive: true })
      const nextMissing = compareHost(BASE, copy)
      expect(shape(nextMissing)).toEqual(expected)
      expect([...nextMissing.patchAdded]).toEqual([])
      expect([...nextMissing.patchRemoved]).toEqual([])
      expect(nextMissing.patchUnchanged).toBe(true)
      expectProse(renderDiff(nextMissing), new Set([SHORTCUTS]))

      const baseMissing = compareHost(copy, BASE)
      expect(shape(baseMissing)).toEqual(expected)
    })
  })

  it('A3 an unchanged entry renders 无变化', () => {
    withBaseCopy((copy) => {
      const text = renderDiff(compareHost(BASE, copy))
      for (const item of ENTRIES) expect(blockOf(text, item.entry), item.entry).toContain('无变化')
    })
  })
})
