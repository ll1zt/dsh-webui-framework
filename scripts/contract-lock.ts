import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'

/** What can be wrong between the contract, its lock, the package version and the CHANGELOG. */
export type ContractLockProblem = 'lock-missing' | 'contract-changed' | 'version-mismatch' | 'changelog-missing'

interface ContractLock {
  version: string
  sha256: string
}

const LOCK_FILE = 'contract/lock.json'
const CONTRACT_FILE = 'contract/index.d.ts'

const readText = (root: string, file: string): string => readFileSync(join(root, file), 'utf8')

/** sha256 hex of the contract with CRLF normalised to LF, so a checkout's line ends do not matter. */
function contractHash(root: string): string {
  return createHash('sha256').update(readText(root, CONTRACT_FILE).replace(/\r\n/g, '\n')).digest('hex')
}

function packageVersion(root: string): string {
  const manifest = JSON.parse(readText(root, 'package.json')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('package.json has no version')
  return manifest.version
}

/** Whether CHANGELOG.md has a `## <version>` heading line (the version must end the word, so 0.1.1 is not 0.1.10). */
function hasChangelogHeading(root: string, version: string): boolean {
  const path = join(root, 'CHANGELOG.md')
  if (!existsSync(path)) return false
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .some((line) => line === `## ${version}` || line.startsWith(`## ${version} `))
}

function readLock(root: string): ContractLock | undefined {
  const path = join(root, LOCK_FILE)
  if (!existsSync(path)) return undefined
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ContractLock>
  return { version: String(parsed.version), sha256: String(parsed.sha256) }
}

/**
 * Compare the contract against its lock.
 * @param root - the package root holding `package.json`, `CHANGELOG.md` and `contract/`.
 * @returns every problem found; an empty array means contract, lock, version and CHANGELOG agree.
 */
export function checkContractLock(root: string): ContractLockProblem[] {
  const lock = readLock(root)
  if (lock === undefined) return ['lock-missing']
  const version = packageVersion(root)
  const problems: ContractLockProblem[] = []
  if (lock.sha256 !== contractHash(root)) problems.push('contract-changed')
  if (lock.version !== version) problems.push('version-mismatch')
  if (!hasChangelogHeading(root, version)) problems.push('changelog-missing')
  return problems
}

/** Rewrite the lock to the current contract and version; returns the reason it refuses, if it does. */
function writeLock(root: string): string | undefined {
  const version = packageVersion(root)
  const sha256 = contractHash(root)
  const lock = readLock(root)
  if (lock !== undefined && lock.sha256 !== sha256 && lock.version === version) {
    return `the contract changed but the version is still ${version}; bump the version in package.json first`
  }
  if (!hasChangelogHeading(root, version)) {
    return `CHANGELOG.md has no "## ${version}" heading; describe the change there first`
  }
  writeFileSync(join(root, LOCK_FILE), `${JSON.stringify({ version, sha256 }, null, 2)}\n`)
  return undefined
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  const root = resolve(process.cwd())
  try {
    if (process.argv.includes('--write')) {
      const refusal = writeLock(root)
      if (refusal === undefined) {
        console.log(`contract-lock: wrote ${LOCK_FILE}`)
      } else {
        console.error(`contract-lock: refused: ${refusal}`)
        process.exitCode = 1
      }
    } else {
      const problems = checkContractLock(root)
      for (const problem of problems) console.error(`contract-lock: ${problem}`)
      if (problems.length === 0) console.log(`contract-lock: ${root} is consistent`)
      else process.exitCode = 1
    }
  } catch (error) {
    console.error(`contract-lock: ${messageOf(error)}`)
    process.exitCode = 1
  }
}
