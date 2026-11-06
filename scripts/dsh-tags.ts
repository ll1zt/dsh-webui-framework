/**
 * Which dist-tags the daily dsh check looks at, and which of those versions were already checked.
 *
 * A version counts as checked when an issue or pull title contains the token `dsh <version>` and
 * the character after it (if any) cannot continue a semver token. So `dsh 0.2.2-rc.1` matches
 * `dsh 0.2.2-rc.1：兼容性检查失败` and `升级到 dsh 0.2.2-rc.1`, but not `dsh 0.2.2-rc.10`.
 */

const TAG_ORDER = ['alpha', 'next', 'latest'] as const

/** Characters that can extend a semver token (core, prerelease, or build). */
const VERSION_CONTINUATION = /[0-9A-Za-z.+-]/

export interface TagTarget {
  tag: 'alpha' | 'next' | 'latest'
  version: string
}

/** Existing non-empty tags in alpha, next, latest order. The same version is kept once, on the first tag. */
export function latestTargets(distTags: Record<string, string>): TagTarget[] {
  const seen = new Set<string>()
  const targets: TagTarget[] = []
  for (const tag of TAG_ORDER) {
    const version = distTags[tag]
    if (typeof version !== 'string' || version === '' || seen.has(version)) continue
    seen.add(version)
    targets.push({ tag, version })
  }
  return targets
}

/** True when some title contains `dsh <version>` as its own version token, not a prefix of a longer one. */
export function alreadyChecked(titles: readonly string[], version: string): boolean {
  const needle = `dsh ${version}`
  return titles.some((title) => {
    for (let from = 0; from < title.length;) {
      const at = title.indexOf(needle, from)
      if (at < 0) return false
      const next = title.charAt(at + needle.length)
      if (!VERSION_CONTINUATION.test(next)) return true
      from = at + 1
    }
    return false
  })
}

/** `latestTargets` minus versions that already appear in an issue or pull title. */
export function planChecks(distTags: Record<string, string>, titles: readonly string[]): TagTarget[] {
  return latestTargets(distTags).filter((target) => !alreadyChecked(titles, target.version))
}
