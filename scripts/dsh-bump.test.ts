import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { bumpManifest, resolveTarget } from './dsh-bump.ts'
import type { DshRegistry, DshTarget } from './dsh-bump.ts'

const SCRIPT = fileURLToPath(new URL('dsh-bump.ts', import.meta.url))
const DSH = '@deepseek-ai/dsh'
const CORDIS = '@deepseek-ai/cordis'
const SCHEMASTERY = '@deepseek-ai/schemastery'

interface FakeOptions {
  tags?: Record<string, string>
  dependencies?: Record<string, string>
}

/** Canned registry; `resolve` answers from a `pkg@range` table and records what it was asked. */
const fakeRegistry = (options: FakeOptions = {}) => {
  const calls: string[] = []
  const ranges: Record<string, string> = {
    [`${CORDIS}@~4.0.7-alpha.1`]: '4.0.7-alpha.3',
    [`${SCHEMASTERY}@~3.18.7-alpha.1`]: '3.18.7-alpha.2',
  }
  const registry: DshRegistry = {
    async distTags(pkg) {
      calls.push(`distTags ${pkg}`)
      return options.tags ?? { latest: '0.1.0', alpha: '0.2.3-alpha.1' }
    },
    async dependencies(pkg, version) {
      calls.push(`dependencies ${pkg}@${version}`)
      return options.dependencies ?? { [CORDIS]: '~4.0.7-alpha.1', [SCHEMASTERY]: '~3.18.7-alpha.1', other: '^1.0.0' }
    },
    async resolve(pkg, range) {
      calls.push(`resolve ${pkg}@${range}`)
      const version = ranges[`${pkg}@${range}`]
      if (version === undefined) throw new Error(`unexpected resolve ${pkg}@${range}`)
      return version
    },
  }
  return { registry, calls }
}

describe('resolveTarget', () => {
  it('A1 without a version takes the alpha tag of @deepseek-ai/dsh and resolves cordis and schemastery from its dependency ranges', async () => {
    const { registry, calls } = fakeRegistry()

    await expect(resolveTarget(undefined, registry)).resolves.toEqual({
      dsh: '0.2.3-alpha.1',
      cordis: '4.0.7-alpha.3',
      schemastery: '3.18.7-alpha.2',
    })
    expect(calls).toContain(`distTags ${DSH}`)
    expect(calls).toContain(`dependencies ${DSH}@0.2.3-alpha.1`)
    expect(calls).toContain(`resolve ${CORDIS}@~4.0.7-alpha.1`)
    expect(calls).toContain(`resolve ${SCHEMASTERY}@~3.18.7-alpha.1`)
  })

  it('A1 a given version wins over the alpha tag and its own dependencies are read', async () => {
    const { registry, calls } = fakeRegistry()

    const target = await resolveTarget('0.2.2-rc.5', registry)

    expect(target.dsh).toBe('0.2.2-rc.5')
    expect(calls).toContain(`dependencies ${DSH}@0.2.2-rc.5`)
    expect(calls).not.toContain(`dependencies ${DSH}@0.2.3-alpha.1`)
  })

  it('A1 no alpha tag is an error that names the missing tag', async () => {
    const { registry } = fakeRegistry({ tags: { latest: '0.1.0' } })

    await expect(resolveTarget(undefined, registry)).rejects.toThrow(/alpha/)
  })

  it('A1 a dsh version that does not depend on cordis or schemastery is an error that names the missing one', async () => {
    const noCordis = fakeRegistry({ dependencies: { [SCHEMASTERY]: '~3.18.7-alpha.1' } })
    await expect(resolveTarget('0.2.3-alpha.1', noCordis.registry)).rejects.toThrow(/cordis/)

    const noSchemastery = fakeRegistry({ dependencies: { [CORDIS]: '~4.0.7-alpha.1' } })
    await expect(resolveTarget('0.2.3-alpha.1', noSchemastery.registry)).rejects.toThrow(/schemastery/)
  })
})

const TARGET: DshTarget = { dsh: '0.2.3-alpha.1', cordis: '4.0.7-alpha.3', schemastery: '3.18.7-alpha.2' }

const manifest = () => ({
  name: '@lllzt/dsh-webui-framework',
  version: '0.0.0',
  scripts: { gate: 'npm run check' },
  devDependencies: {
    [CORDIS]: '4.0.6-alpha.1',
    '@deepseek-ai/dsh-client-store': '0.2.2-alpha.2',
    '@deepseek-ai/dsh-client-ui-theme': '0.2.2-alpha.2',
    '@deepseek-ai/dsh-web-app': '0.2.2-alpha.2',
    '@deepseek-ai/cosmokit': '^1.9.0',
    vitest: '^4.1.12',
  },
  dependencies: { [SCHEMASTERY]: '3.18.6-alpha.1' },
})

describe('bumpManifest', () => {
  it('A2 moves every dsh-* dependency to the target version, cordis and schemastery to theirs, and leaves the rest alone', () => {
    const input = manifest()
    const before = structuredClone(input)

    const { manifest: bumped, changed } = bumpManifest(input, TARGET)

    expect(changed).toBe(true)
    expect(bumped).toEqual({
      ...before,
      devDependencies: {
        [CORDIS]: '4.0.7-alpha.3',
        '@deepseek-ai/dsh-client-store': '0.2.3-alpha.1',
        '@deepseek-ai/dsh-client-ui-theme': '0.2.3-alpha.1',
        '@deepseek-ai/dsh-web-app': '0.2.3-alpha.1',
        '@deepseek-ai/cosmokit': '^1.9.0',
        vitest: '^4.1.12',
      },
      dependencies: { [SCHEMASTERY]: '3.18.7-alpha.2' },
    })
    expect(input).toEqual(before)
  })

  it('A2 a manifest already at the target is reported unchanged and comes back equal', () => {
    const current = bumpManifest(manifest(), TARGET).manifest

    const again = bumpManifest(current, TARGET)

    expect(again.changed).toBe(false)
    expect(again.manifest).toEqual(current)
  })
})

describe('dsh-bump CLI', () => {
  let dir = ''
  afterEach(async () => {
    if (dir !== '') await rm(dir, { recursive: true, force: true })
    dir = ''
  })

  it('A1 --version without a value exits 1 before any lookup and leaves package.json untouched', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-bump-'))
    const text = JSON.stringify(manifest(), null, 2) + '\n'
    await writeFile(join(dir, 'package.json'), text)

    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [SCRIPT, '--version'], { cwd: dir }, (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
        resolve({ code, stdout, stderr })
      })
    })

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--version')
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(text)
  })
})
