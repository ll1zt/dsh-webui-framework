import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'

/**
 * Does the installed dsh-web-app's assembly table still line up with the ids this repo closes?
 * The host's `cordis.patch.yml` inserts its rows by id and this repo's patch disables 51 of them
 * by id, so a host that renames, drops or adds a row changes what the page boots with. The
 * comparison fails with the row named, instead of leaving it to a warning in `--dump-config`.
 */

const HOST_PACKAGE = '@deepseek-ai/dsh-web-app'

/** The shape of `scripts/host-compat.json`. */
export interface HostCompatFile {
  hostPackage: '@deepseek-ai/dsh-web-app'
  /** Host rows this repo leaves enabled, in host order. */
  kept: string[]
  /** Ids this repo still disables that the host no longer has, each with the host version it went missing in. */
  knownMissing: Record<string, string>
}

export interface HostCompatReport {
  /** Disabled here, absent from the host, and not in `knownMissing`; in patch order. */
  missing: string[]
  /** Inserted by the host, neither disabled here nor in `kept`; in host order. */
  unlisted: string[]
}

type Node = Record<string, unknown>

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Collects the ids of `rows` and, depth first, of the rows nested under their own `insert`. */
function collectRows(rows: unknown, ids: Set<string>): void {
  if (!Array.isArray(rows)) return
  for (const row of rows) {
    if (!isNode(row)) continue
    if (typeof row.id === 'string') ids.add(row.id)
    collectRows(row.insert, ids)
  }
}

/**
 * The ids of every row in a host assembly table: entries of `insert` arrays at any depth, in order
 * of appearance, once each. A top-level `- id: x` entry with only `config` or `disabled` overrides
 * a row and is not one.
 */
export function hostRowIds(patchYaml: string): string[] {
  // The host table carries `!!js` tags; with logging silent the parser keeps them as plain values.
  const table: unknown = parse(patchYaml, { logLevel: 'silent' })
  const ids = new Set<string>()
  if (Array.isArray(table)) {
    for (const entry of table) if (isNode(entry)) collectRows(entry.insert, ids)
  }
  return [...ids]
}

export function compareHostRows(
  hostRows: readonly string[],
  disabled: readonly string[],
  file: HostCompatFile,
): HostCompatReport {
  const host = new Set(hostRows)
  const closed = new Set(disabled)
  const kept = new Set(file.kept)
  return {
    missing: disabled.filter((id) => !host.has(id) && !Object.hasOwn(file.knownMissing, id)),
    unlisted: hostRows.filter((id) => !closed.has(id) && !kept.has(id)),
  }
}

/** The ids the repo's `cordis.patch.yml` disables, in file order. */
function disabledIds(patchYaml: string): string[] {
  const table: unknown = parse(patchYaml, { logLevel: 'silent' })
  if (!Array.isArray(table)) return []
  return table.flatMap((entry) =>
    isNode(entry) && entry.disabled === true && typeof entry.id === 'string' ? [entry.id] : [],
  )
}

function runCli(root: string): number {
  const hostPatch = join(root, 'node_modules', HOST_PACKAGE, 'cordis.patch.yml')
  if (!existsSync(hostPatch)) {
    console.error(`host-compat: ${HOST_PACKAGE} is not installed (${hostPatch} not found)`)
    return 2
  }
  let report: HostCompatReport
  try {
    const file = JSON.parse(readFileSync(join(root, 'scripts/host-compat.json'), 'utf8')) as HostCompatFile
    const disabled = disabledIds(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'))
    report = compareHostRows(hostRowIds(readFileSync(hostPatch, 'utf8')), disabled, file)
  } catch (error) {
    console.error(`host-compat: ${messageOf(error)}`)
    return 2
  }
  for (const id of report.missing) console.log(`missing: ${id} is disabled here but the host has no such row`)
  for (const id of report.unlisted) console.log(`unlisted: ${id} is a host row, neither disabled here nor in kept`)
  if (report.missing.length === 0 && report.unlisted.length === 0) {
    console.log('host-compat: ok')
    return 0
  }
  return 1
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = runCli(process.cwd())
}
