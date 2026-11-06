import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'

/**
 * Drops `@deepseek-ai/*` entries from a package-lock so the next install re-resolves only those.
 *
 *   node scripts/dsh-relock.ts [--write]
 *
 * Prints one JSON line `{"pruned":…,"kept":…}`. With `--write`, rewrites package-lock.json
 * (2-space JSON, trailing newline). A missing lockfile prints zeros and exits 0.
 */

/** npm lockfile v2/v3. Only the fields the prune names are fixed; every other field is kept. */
export interface PackageLock {
  name?: string
  version?: string
  lockfileVersion?: number
  packages?: Record<string, Record<string, unknown>>
  [key: string]: unknown
}

/** How many lockfile `packages` entries were removed and how many stayed. */
export interface RelockResult {
  pruned: number
  kept: number
}

/**
 * Direct installs of `@deepseek-ai/*`, including packages nested under them.
 * `node_modules/@deepseek-ai-extra/…` and a host package nested under something else do not match.
 */
const HOST_PREFIX = 'node_modules/@deepseek-ai/'

/**
 * A new lockfile with every `packages` key that starts with `node_modules/@deepseek-ai/` removed.
 * Other keys stay in their original order, other top-level fields are copied, and `lock` is not modified.
 * Untouched entry values are shared with the input.
 */
export function pruneDshEntries(lock: PackageLock): { lock: PackageLock } & RelockResult {
  const source = lock.packages
  if (source === undefined) return { lock: { ...lock }, pruned: 0, kept: 0 }
  const packages: Record<string, Record<string, unknown>> = {}
  let pruned = 0
  let kept = 0
  for (const [key, entry] of Object.entries(source)) {
    if (key.startsWith(HOST_PREFIX)) {
      pruned += 1
      continue
    }
    packages[key] = entry
    kept += 1
  }
  return { lock: { ...lock, packages }, pruned, kept }
}

const USAGE = 'usage: node scripts/dsh-relock.ts [--write]'
const LOCK_NAME = 'package-lock.json'

function runCli(root: string, args: readonly string[]): number {
  let write = false
  for (const arg of args) {
    if (arg === '--write') {
      write = true
      continue
    }
    console.error(USAGE)
    return 1
  }
  const path = join(root, LOCK_NAME)
  if (!existsSync(path)) {
    console.log(JSON.stringify({ pruned: 0, kept: 0 }))
    return 0
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('package-lock.json is not an object')
    }
    const { lock, pruned, kept } = pruneDshEntries(parsed as PackageLock)
    if (write) writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`)
    console.log(JSON.stringify({ pruned, kept }))
    return 0
  } catch (error) {
    console.error(`dsh-relock: ${messageOf(error)}`)
    return 1
  }
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = runCli(process.cwd(), process.argv.slice(2))
}
