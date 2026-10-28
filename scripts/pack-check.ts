import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** One entry the packed tarball got wrong: absent when required, or present when it must not ship. */
export interface PackViolation {
  file: string
  reason: 'missing' | 'forbidden'
}

/** Entries the plugin cannot boot without: the manifest, both entry points and the host patch. */
const REQUIRED_FILES = ['package.json', 'lib/index.js', 'lib/client.js', 'cordis.patch.yml'] as const

/** Directories holding sources, tooling, docs or dependencies; none of them belongs in the tarball. */
const FORBIDDEN_DIRS = new Set(['src', 'scripts', 'docs', 'ref', 'node_modules'])

const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.test.js', '.test.mjs'] as const

const LOCAL_DOC_SUFFIX = '.local.md'

interface PackListing {
  files: string[]
  error: string | undefined
}

const segments = (file: string): string[] => file.split('/').filter((segment) => segment.length > 0)

const endsWithAny = (value: string, suffixes: readonly string[]): boolean =>
  suffixes.some((suffix) => value.endsWith(suffix))

/** A path is judged by its segments so `lib/client.abc123.js` stays allowed while `src/a.ts` does not. */
function isForbidden(file: string): boolean {
  const parts = segments(file)
  const basename = parts[parts.length - 1] ?? file
  if (parts.slice(0, -1).some((segment) => FORBIDDEN_DIRS.has(segment))) return true
  if (basename.endsWith(LOCAL_DOC_SUFFIX)) return true
  return parts.some((segment) => endsWithAny(segment, TEST_SUFFIXES))
}

/**
 * Check the file list of a packed tarball against what the package must and must not ship.
 * `package.json`'s `files` list is the single source of truth for the pack, so this guards the
 * published shape rather than the working tree.
 * @param files - the `path` entries of `npm pack --dry-run --json`.
 * @returns every missing or forbidden entry; an empty array means the pack is shippable.
 */
export function checkPackFiles(files: readonly string[]): PackViolation[] {
  const present = new Set(files)
  const violations: PackViolation[] = []
  for (const required of REQUIRED_FILES) {
    if (!present.has(required)) violations.push({ file: required, reason: 'missing' })
  }
  for (const file of files) {
    if (isForbidden(file)) violations.push({ file, reason: 'forbidden' })
  }
  return violations
}

/** npm prints lifecycle banners before the report, so the payload starts at the first JSON line. */
function jsonPayload(stdout: string): string | undefined {
  const lines = stdout.split('\n')
  const start = lines.findIndex((line) => /^[[{]/.test(line))
  return start === -1 ? undefined : lines.slice(start).join('\n')
}

/** Paths of the files npm would put in the tarball, or the reason the report could not be read. */
function parsePackedPaths(stdout: string): string[] | undefined {
  const payload = jsonPayload(stdout)
  if (payload === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  const paths: string[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const rows: unknown = (entry as { files?: unknown }).files
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue
      const path: unknown = (row as { path?: unknown }).path
      if (typeof path === 'string') paths.push(path)
    }
  }
  return paths.length === 0 ? undefined : paths
}

/**
 * Ask npm what the tarball of `dir` would contain.
 * Lifecycle scripts are skipped: `prepack` builds `lib/`, which both pollutes stdout ahead of the
 * report and would make a read-only check mutate the tree.
 */
function readPackedPaths(dir: string): PackListing {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: dir,
    encoding: 'utf8',
  })
  if (result.error !== undefined) {
    return { files: [], error: `cannot run npm pack in ${dir}: ${result.error.message}` }
  }
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim().split('\n').slice(0, 4).join(' ')
    return { files: [], error: `npm pack failed in ${dir} with exit code ${String(result.status)}: ${detail}` }
  }
  const paths = parsePackedPaths(result.stdout ?? '')
  if (paths === undefined) {
    // A manifest npm cannot describe must never read as a clean pack.
    return { files: [], error: `npm pack reported no files or an unparsable report for ${dir}` }
  }
  return { files: paths, error: undefined }
}

function report(dir: string, violations: readonly PackViolation[], fileCount: number): number {
  if (violations.length === 0) {
    console.log(`pack-check: ${dir} packs ${fileCount} files, all required entries present and allowed`)
    return 0
  }
  for (const violation of violations) {
    const detail = violation.reason === 'missing' ? 'is missing from the pack' : 'is forbidden in the pack'
    console.error(`pack-check: ${violation.reason}: ${violation.file} ${detail}`)
  }
  console.error(`pack-check: ${violations.length} violation(s) in ${dir}`)
  return 1
}

const invokedAsScript =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedAsScript) {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(process.argv[2] ?? resolve(scriptDir, '..'))
  const listing = readPackedPaths(dir)
  if (listing.error !== undefined) {
    console.error(`pack-check: ${listing.error}`)
    process.exitCode = 1
  } else {
    process.exitCode = report(dir, checkPackFiles(listing.files), listing.files.length)
  }
}
