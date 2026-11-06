import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WEBUI_CONTRACT_VERSION } from '../src/lib/contract-version.ts'
import { compilePreviousFixtures } from './contract-compat.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PREVIOUS = join(ROOT, 'scripts/fixtures/contract/previous')

const read = (path: string): string => readFileSync(path, 'utf8')

/** Bodies of `*.fixture.txt` under `dir`, including nested ones. */
const fixtureBodies = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  const found: string[] = []
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile() && entry.name.endsWith('.fixture.txt')) found.push(read(path))
    }
  }
  walk(dir)
  return found
}

/** Token name and the host ramp it must alias. Warning is `warn` on the host, not `warning`. */
const STATE_TOKENS = [
  ['--state-error-fg', '--dsw-alias-state-error-primary'],
  ['--state-error-bg', '--dsw-alias-state-error-tertiary'],
  ['--state-warning-fg', '--dsw-alias-state-warn-primary'],
  ['--state-warning-bg', '--dsw-alias-state-warn-tertiary'],
  ['--state-success-fg', '--dsw-alias-state-success-primary'],
  ['--state-success-bg', '--dsw-alias-state-success-tertiary'],
] as const

const REASONS = ['host-refused', 'no-session', 'unmounted', 'blank-text'] as const

describe('0.4.0 docs', () => {
  it('A1 package.json, package-lock.json, contract/lock.json and WEBUI_CONTRACT_VERSION agree on 0.4.0', () => {
    const manifest = JSON.parse(read(join(ROOT, 'package.json'))) as { version: string }
    const lockfile = JSON.parse(read(join(ROOT, 'package-lock.json'))) as {
      version: string
      packages: { '': { version: string } }
    }
    const contractLock = JSON.parse(read(join(ROOT, 'contract/lock.json'))) as { version: string }
    expect(manifest.version).toBe('0.4.0')
    expect(lockfile.version).toBe('0.4.0')
    expect(lockfile.packages[''].version).toBe('0.4.0')
    expect(contractLock.version).toBe('0.4.0')
    expect(WEBUI_CONTRACT_VERSION).toBe('0.4.0')
    expect(WEBUI_CONTRACT_VERSION).toBe(manifest.version)
    expect(WEBUI_CONTRACT_VERSION).toBe(contractLock.version)
    expect(WEBUI_CONTRACT_VERSION).toBe(lockfile.packages[''].version)
  })

  it('A2 readme lists state tokens, placement, contractVersion and send/stop reasons, and RELEASE.md lists the release steps', () => {
    const readme = read(join(ROOT, 'README.md'))
    for (const [token, host] of STATE_TOKENS) {
      expect(readme, token).toContain(token)
      expect(readme, host).toContain(host)
    }
    const themeAt = readme.indexOf('### 主题 token')
    const viewAt = readme.indexOf('### 只读的布局视图')
    expect(themeAt, '### 主题 token').toBeGreaterThanOrEqual(0)
    expect(viewAt, '### 只读的布局视图').toBeGreaterThan(themeAt)

    expect(readme).toContain('OpenPlacement')
    expect(readme).toContain('placement')
    expect(readme).toMatch(/\bleft\b/)
    expect(readme).toMatch(/\bright\b/)
    expect(readme).toMatch(/\btop\b/)
    expect(readme).toMatch(/\bbottom\b/)

    expect(readme).toContain('contractVersion')
    expect(readme).toContain('isCompatibleContract')
    expect(readme).toContain('contract-version.ts')
    expect(readme).toMatch(/0\.x/)
    expect(readme).toMatch(/1\.0/)
    expect(readme).toMatch(/次版本|minor/)
    expect(readme).toMatch(/主版本|major/)

    expect(readme).toContain('SessionActionResult')
    for (const reason of REASONS) expect(readme, reason).toContain(reason)
    expect(readme).not.toContain('解析为 `true`')
    expect(readme).not.toContain('解析为 `false`')
    expect(readme).not.toContain('并以 `false` 落定')

    const releasePath = join(ROOT, 'RELEASE.md')
    expect(existsSync(releasePath), 'RELEASE.md').toBe(true)
    const release = read(releasePath)
    expect(release).toMatch(/npm pack|pack:check/)
    expect(release).toMatch(/\btag\b/)
    expect(release).toMatch(/\bgate\b/)
    expect(release).toContain('host-compat')
  })

  it('A3 previous fixtures compile clean and mention SessionActionResult', () => {
    const bodies = fixtureBodies(PREVIOUS)
    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies.some((body) => body.includes('SessionActionResult'))).toBe(true)
    expect(compilePreviousFixtures(ROOT)).toEqual([])
  }, 60_000)
})
