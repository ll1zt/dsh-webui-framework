import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'
import { pruneDshEntries } from './dsh-relock.ts'
import type { PackageLock } from './dsh-relock.ts'

/**
 * Moves package.json to a dsh release: every `@deepseek-ai/dsh-*` dependency to that version,
 * and cordis / schemastery to the versions the release's own dependency ranges resolve to.
 *
 *   node scripts/dsh-bump.ts [--version <v>] [--write]
 *
 * Without `--version` the `alpha` dist-tag of `@deepseek-ai/dsh` is used. Prints one JSON line
 * `{"current":…,"target":…,"changed":…,"relocked":…}`. Files are written only with `--write`:
 * package.json when `changed`, then package-lock.json when it still has `@deepseek-ai/*` entries.
 * `relocked` is true only when that lockfile was pruned on disk.
 * Exit 1 when the target cannot be resolved or the arguments are wrong.
 */

const DSH = '@deepseek-ai/dsh'
const CORDIS = '@deepseek-ai/cordis'
const SCHEMASTERY = '@deepseek-ai/schemastery'
const HOST_PREFIX = '@deepseek-ai/dsh-'

export interface DshTarget {
  dsh: string
  cordis: string
  schemastery: string
}

/** The three registry questions the bump asks; `resolve` answers with the highest version satisfying `range`. */
export interface DshRegistry {
  distTags(pkg: string): Promise<Record<string, string>>
  dependencies(pkg: string, version: string): Promise<Record<string, string>>
  resolve(pkg: string, range: string): Promise<string>
}

export interface PackageManifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

/** The dsh release to move to, with the cordis and schemastery versions it was published against. */
export async function resolveTarget(version: string | undefined, registry: DshRegistry): Promise<DshTarget> {
  let dsh = version
  if (dsh === undefined) {
    const alpha = (await registry.distTags(DSH)).alpha
    if (alpha === undefined || alpha === '') throw new Error(`${DSH} has no "alpha" dist-tag`)
    dsh = alpha
  }
  const dependencies = await registry.dependencies(DSH, dsh)
  const rangeOf = (pkg: string): string => {
    const range = dependencies[pkg]
    if (range === undefined) throw new Error(`${DSH}@${dsh} does not depend on ${pkg}`)
    return range
  }
  const cordisRange = rangeOf(CORDIS)
  const schemasteryRange = rangeOf(SCHEMASTERY)
  return {
    dsh,
    cordis: await registry.resolve(CORDIS, cordisRange),
    schemastery: await registry.resolve(SCHEMASTERY, schemasteryRange),
  }
}

/** The version `name` should have under `target`, or `undefined` for a dependency the bump leaves alone. */
function targetVersion(name: string, target: DshTarget): string | undefined {
  if (name.startsWith(HOST_PREFIX)) return target.dsh
  if (name === CORDIS) return target.cordis
  if (name === SCHEMASTERY) return target.schemastery
  return undefined
}

/** `manifest` with the dsh family, cordis and schemastery moved to `target`; the input is not modified. */
export function bumpManifest(
  manifest: PackageManifest,
  target: DshTarget,
): { manifest: PackageManifest; changed: boolean } {
  let changed = false
  const bumpSection = (section: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (section === undefined) return undefined
    const next: Record<string, string> = {}
    for (const [name, range] of Object.entries(section)) {
      const wanted = targetVersion(name, target)
      if (wanted !== undefined && wanted !== range) changed = true
      next[name] = wanted ?? range
    }
    return next
  }
  const result: PackageManifest = { ...manifest }
  const dependencies = bumpSection(manifest.dependencies)
  const devDependencies = bumpSection(manifest.devDependencies)
  if (dependencies !== undefined) result.dependencies = dependencies
  if (devDependencies !== undefined) result.devDependencies = devDependencies
  return { manifest: result, changed }
}

/** The dsh version package.json is on now: that of its first `@deepseek-ai/dsh-*` dependency. */
function currentVersion(manifest: PackageManifest): string | null {
  for (const section of [manifest.dependencies, manifest.devDependencies]) {
    for (const [name, range] of Object.entries(section ?? {})) {
      if (name.startsWith(HOST_PREFIX)) return range
    }
  }
  return null
}

function npmView(args: string[]): Promise<unknown> {
  const registry = process.env.npm_config_registry
  const registryArgs = registry === undefined || registry === '' ? [] : ['--registry', registry]
  return new Promise((resolve, reject) => {
    execFile('npm', ['view', ...args, '--json', ...registryArgs], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error !== null) {
        reject(new Error(`npm view ${args.join(' ')} failed: ${messageOf(error)}`))
        return
      }
      // npm prints nothing at all when the field is absent
      resolve(stdout.trim() === '' ? undefined : JSON.parse(stdout))
    })
  })
}

const asRecord = (value: unknown): Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, string>) : {}

/** Compare two semver strings by precedence (build metadata ignored). */
function compareVersions(a: string, b: string): number {
  const split = (version: string) => {
    const [core = '', pre] = (version.split('+')[0] ?? '').split(/-(.*)/s)
    return { core: core.split('.').map(Number), pre: pre === undefined ? [] : pre.split('.') }
  }
  const left = split(a)
  const right = split(b)
  for (let i = 0; i < 3; i++) {
    const diff = (left.core[i] ?? 0) - (right.core[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (left.pre.length === 0 || right.pre.length === 0) return right.pre.length - left.pre.length
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i]
    const y = right.pre[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const xNumeric = /^\d+$/.test(x)
    const yNumeric = /^\d+$/.test(y)
    if (xNumeric && yNumeric) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y)
    } else if (xNumeric !== yNumeric) {
      return xNumeric ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

/** A registry backed by `npm view`; honours `npm_config_registry`. */
export function npmRegistry(): DshRegistry {
  return {
    async distTags(pkg) {
      return asRecord(await npmView([pkg, 'dist-tags']))
    },
    async dependencies(pkg, version) {
      return asRecord(await npmView([`${pkg}@${version}`, 'dependencies']))
    },
    async resolve(pkg, range) {
      const found = await npmView([`${pkg}@${range}`, 'version'])
      const versions = (Array.isArray(found) ? found : [found]).filter((v): v is string => typeof v === 'string')
      const highest = versions.sort(compareVersions).at(-1)
      if (highest === undefined) throw new Error(`no version of ${pkg} satisfies ${range}`)
      return highest
    },
  }
}

const USAGE = 'usage: node scripts/dsh-bump.ts [--version <v>] [--write]'

interface ParsedArgs {
  version: string | undefined
  write: boolean
}

/** `--version <v>` and `--write`, in either order. `undefined` means the arguments are wrong. */
function parseArgs(args: readonly string[]): ParsedArgs | undefined {
  let version: string | undefined
  let write = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--write') {
      write = true
      continue
    }
    if (arg === '--version') {
      const value = args[index + 1]
      if (value === undefined || value === '' || value.startsWith('-')) return undefined
      version = value
      index += 1
      continue
    }
    return undefined
  }
  return { version, write }
}

/** Drop `@deepseek-ai/*` entries from package-lock.json. True only when at least one was removed. */
function pruneLockfile(root: string): boolean {
  const path = join(root, 'package-lock.json')
  if (!existsSync(path)) return false
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('package-lock.json is not an object')
  }
  const result = pruneDshEntries(parsed as PackageLock)
  if (result.pruned === 0) return false
  writeFileSync(path, `${JSON.stringify(result.lock, null, 2)}\n`)
  return true
}

async function runCli(root: string, args: readonly string[]): Promise<number> {
  const parsed = parseArgs(args)
  if (parsed === undefined) {
    console.error(USAGE)
    return 1
  }
  try {
    const file = join(root, 'package.json')
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as PackageManifest
    const target = await resolveTarget(parsed.version, npmRegistry())
    const { manifest: bumped, changed } = bumpManifest(manifest, target)
    if (parsed.write && changed) writeFileSync(file, `${JSON.stringify(bumped, null, 2)}\n`)
    const relocked = parsed.write ? pruneLockfile(root) : false
    console.log(JSON.stringify({ current: currentVersion(manifest), target: target.dsh, changed, relocked }))
    return 0
  } catch (error) {
    console.error(`dsh-bump: ${messageOf(error)}`)
    return 1
  }
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = await runCli(process.cwd(), process.argv.slice(2))
}
