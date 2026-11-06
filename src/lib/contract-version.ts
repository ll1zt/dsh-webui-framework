/** Framework contract version, the same string as `package.json`'s `version`. */
export const WEBUI_CONTRACT_VERSION: string = '0.4.0'

interface ParsedContractVersion {
  major: number
  minor: number
}

/**
 * `MAJOR.MINOR.PATCH` with any further numeric segments. A missing segment (including a missing patch),
 * a non-numeric segment or an empty string does not parse.
 */
function parseContractVersion(version: string): ParsedContractVersion | undefined {
  if (!/^\d+(?:\.\d+){2,}$/.test(version)) return undefined
  const [major, minor] = version.split('.')
  if (major === undefined || minor === undefined) return undefined
  return { major: Number(major), minor: Number(minor) }
}

/**
 * Whether a plugin compiled against `plugin` can register on a framework of version `host`.
 * A 0.x contract matches on the minor version; from 1.0 it matches on the major version.
 * A version that does not parse is not compatible.
 */
export function isCompatibleContract(host: string, plugin: string): boolean {
  const left = parseContractVersion(host)
  const right = parseContractVersion(plugin)
  if (left === undefined || right === undefined) return false
  if (left.major !== right.major) return false
  return left.major > 0 || left.minor === right.minor
}
