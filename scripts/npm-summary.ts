/**
 * Turns an npm install log into a one-line conflict summary.
 *
 * ERESOLVE logs contribute one entry per package, gathered from `Found:`,
 * `peer <pkg>@"<range>"`, `Conflicting peer dependency:`, and
 * `<pkg>@"<range>" from the root project`. Anything else keeps only the last
 * `npm error` line, so a 404 that happens to mention `Found:` stays a 404.
 */

export interface NpmConflict {
  package: string
  versions: readonly string[]
}

export interface NpmSummary {
  summary: string
  conflicts: readonly NpmConflict[]
}

const PACKAGE = String.raw`(?:@[^\s@/]+\/)?[^\s@/]+`
const BARE_VERSION = String.raw`[^\s"']+`
const QUOTED_VERSION = String.raw`[^"]+`

/** Line shapes npm prints while explaining an ERESOLVE, in the order they are scanned. */
const CONFLICT_SOURCES = [
  String.raw`(?:^|\s)Found:\s+(${PACKAGE})@(${BARE_VERSION})`,
  String.raw`(?:^|\s)peer\s+(${PACKAGE})@"(${QUOTED_VERSION})"`,
  String.raw`(?:^|\s)Conflicting peer dependency:\s+(${PACKAGE})@(${BARE_VERSION})`,
  String.raw`(?:^|\s)(${PACKAGE})@"(${QUOTED_VERSION})"\s+from the root project`,
]

interface Hit {
  index: number
  package: string
  version: string
}

function acceptablePackage(name: string): boolean {
  return name !== '' && !name.includes('node_modules') && !name.includes('cookie=') && !name.includes('{{')
}

function acceptableVersion(version: string): boolean {
  return (
    version !== '' &&
    !version.includes('/') &&
    !version.includes('node_modules') &&
    !version.includes('cookie=') &&
    !version.includes('?token=') &&
    !version.includes('{{')
  )
}

function hitsOn(line: string): Hit[] {
  const hits: Hit[] = []
  for (const source of CONFLICT_SOURCES) {
    const pattern = new RegExp(source, 'g')
    for (const match of line.matchAll(pattern)) {
      const name = match[1]
      const version = match[2]
      if (name === undefined || version === undefined) continue
      if (!acceptablePackage(name) || !acceptableVersion(version)) continue
      hits.push({ index: match.index ?? 0, package: name, version })
    }
  }
  hits.sort((left, right) => left.index - right.index)
  return hits
}

function conflictsFrom(text: string): NpmConflict[] {
  const versions = new Map<string, string[]>()
  for (const line of text.split(/\r?\n/)) {
    const stripped = line.replace(/^npm error ?/, '')
    for (const hit of hitsOn(stripped)) {
      const list = versions.get(hit.package)
      if (list === undefined) {
        versions.set(hit.package, [hit.version])
        continue
      }
      if (!list.includes(hit.version)) list.push(hit.version)
    }
  }
  return [...versions.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, list]) => ({ package: name, versions: list }))
}

/** The last `npm error` line with that prefix removed, or '' when the log has none. */
function lastNpmError(text: string): string {
  let summary = ''
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('npm error')) continue
    summary = line.replace(/^npm error ?/, '')
  }
  return summary
}

export function summarizeNpmError(text: string): NpmSummary {
  if (!text.includes('ERESOLVE')) return { summary: lastNpmError(text), conflicts: [] }
  const conflicts = conflictsFrom(text)
  const listed = conflicts.map((conflict) => `${conflict.package}@${conflict.versions[0]}`).join(', ')
  const summary =
    listed === ''
      ? `ERESOLVE: ${conflicts.length} conflicting package(s)`
      : `ERESOLVE: ${conflicts.length} conflicting package(s): ${listed}`
  return { summary, conflicts }
}
