import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'
import { hostRowIds } from './host-compat.ts'

/**
 * Text diff of the host packages this repo imports, plus the host assembly table.
 *
 *   node scripts/host-diff.ts --base <dir> --next <dir>
 *
 * Each directory is either a tree root (containing `node_modules`) or a `node_modules` directory.
 * Prints a Markdown fragment: one bullet per entry (`无变化` when the `.d.ts` texts match, otherwise
 * the repo files that import it, or `framework-wide` when the entry has no single file), then the
 * added and removed row ids of `@deepseek-ai/dsh-web-app/cordis.patch.yml`.
 */

export interface EntryDiff {
  entry: string
  files: readonly string[]
  changed: boolean
}

export interface HostDiffReport {
  entries: readonly EntryDiff[]
  patchAdded: readonly string[]
  patchRemoved: readonly string[]
  patchUnchanged: boolean
}

interface EntrySpec {
  entry: string
  files: readonly string[]
}

/**
 * Entry → repo files that import it. An empty list is framework-wide: cordis, the client store
 * and schemastery are used across the framework rather than from one module.
 * Fixed from the current `src/` imports; subpath imports (`…/client`) belong to the same package.
 */
const ENTRIES: readonly EntrySpec[] = [
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

const HOST_PATCH = join('node_modules', '@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml')

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory()
}

/** Every `*.d.ts` under `dir` (not `.d.ts.map`), keyed by path relative to `dir`. */
function collectDts(dir: string): Map<string, string> {
  const found = new Map<string, string>()
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const path = join(current, name)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        walk(path)
        continue
      }
      if (stat.isFile() && name.endsWith('.d.ts')) found.set(relative(dir, path), readFileSync(path, 'utf8'))
    }
  }
  walk(dir)
  return found
}

/** True when the declaration texts differ, or the package directory is missing on either side. */
function declarationsChanged(baseDir: string, nextDir: string): boolean {
  if (!isDirectory(baseDir) || !isDirectory(nextDir)) return true
  const base = collectDts(baseDir)
  const next = collectDts(nextDir)
  if (base.size !== next.size) return true
  for (const [path, text] of base) {
    if (next.get(path) !== text) return true
  }
  return false
}

/** Row ids of the host assembly table, in host order. A missing file is an empty table. */
function readPatchIds(root: string): string[] {
  const path = join(root, HOST_PATCH)
  if (!existsSync(path)) return []
  return hostRowIds(readFileSync(path, 'utf8'))
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** Ids present in `next` but not `base`, keeping `next`'s host order. */
function idsAdded(base: readonly string[], next: readonly string[]): string[] {
  const have = new Set(base)
  return next.filter((id) => !have.has(id))
}

/** Ids present in `base` but not `next`, keeping `base`'s host order. */
function idsRemoved(base: readonly string[], next: readonly string[]): string[] {
  const have = new Set(next)
  return base.filter((id) => !have.has(id))
}

export function compareHost(baseRoot: string, nextRoot: string): HostDiffReport {
  const baseIds = readPatchIds(baseRoot)
  const nextIds = readPatchIds(nextRoot)
  const patchAdded = idsAdded(baseIds, nextIds)
  const patchRemoved = idsRemoved(baseIds, nextIds)
  return {
    entries: ENTRIES.map((item) => ({
      entry: item.entry,
      files: [...item.files],
      changed: declarationsChanged(
        join(baseRoot, 'node_modules', item.entry),
        join(nextRoot, 'node_modules', item.entry),
      ),
    })),
    patchAdded,
    patchRemoved,
    patchUnchanged: sameList(baseIds, nextIds),
  }
}

/** One bullet per entry, then the assembly-table ids that appeared or disappeared. */
export function renderDiff(report: HostDiffReport): string {
  const lines = ['## 宿主差异', '']
  for (const item of report.entries) {
    const wide = item.files.length === 0 ? '（framework-wide）' : ''
    if (!item.changed) {
      lines.push(`- ${item.entry}：无变化${wide}`)
      continue
    }
    const affected = item.files.length === 0 ? 'framework-wide' : item.files.join('、')
    lines.push(`- ${item.entry}：${affected}`)
  }
  lines.push('', '## 装配表（patch）', '')
  if (report.patchUnchanged) {
    lines.push('装配表无增删。')
  } else {
    if (report.patchAdded.length > 0) {
      lines.push('新增：')
      for (const id of report.patchAdded) lines.push(`- ${id}`)
    }
    if (report.patchRemoved.length > 0) {
      lines.push('删除：')
      for (const id of report.patchRemoved) lines.push(`- ${id}`)
    }
    if (report.patchAdded.length === 0 && report.patchRemoved.length === 0) lines.push('装配表行序有变化。')
  }
  return `${lines.join('\n')}\n`
}

/** A `node_modules` directory compares as its parent tree; anything else is already a tree root. */
function rootOf(dir: string): string {
  return basename(dir) === 'node_modules' ? dirname(dir) : dir
}

function flagValue(args: readonly string[], flag: string): string | null {
  const index = args.indexOf(flag)
  if (index < 0) return null
  const value = args[index + 1]
  if (value === undefined || value === '' || value.startsWith('--')) return null
  return value
}

const USAGE = 'usage: node scripts/host-diff.ts --base <dir> --next <dir>'

function runCli(args: readonly string[]): number {
  const base = flagValue(args, '--base')
  const next = flagValue(args, '--next')
  if (base === null || next === null) {
    console.error(USAGE)
    return 2
  }
  try {
    process.stdout.write(renderDiff(compareHost(rootOf(base), rootOf(next))))
    return 0
  } catch (error) {
    console.error(`host-diff: ${messageOf(error)}`)
    return 1
  }
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = runCli(process.argv.slice(2))
}
