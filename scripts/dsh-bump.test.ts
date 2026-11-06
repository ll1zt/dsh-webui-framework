import { execFile } from 'node:child_process'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
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

  /** Local `npm` that answers the bump's `npm view` calls. Nothing here dials a registry. */
  const installFakeNpm = async (root: string) => {
    const bin = join(root, 'bin')
    await mkdir(bin)
    const file = join(bin, 'npm')
    await writeFile(
      file,
      `#!${process.execPath}
const spec = process.argv[3]
const field = process.argv[4]
const answers = {
  '@deepseek-ai/dsh dist-tags': '{"latest":"0.1.0","alpha":"0.2.3-alpha.1"}',
  '@deepseek-ai/dsh@0.2.3-alpha.1 dependencies':
    '{"@deepseek-ai/cordis":"~4.0.7-alpha.1","@deepseek-ai/schemastery":"~3.18.7-alpha.1"}',
  '@deepseek-ai/cordis@~4.0.7-alpha.1 version': '"4.0.7-alpha.3"',
  '@deepseek-ai/schemastery@~3.18.7-alpha.1 version': '"3.18.7-alpha.2"',
}
const answer = answers[spec + ' ' + field]
if (answer === undefined) {
  console.error('unexpected npm ' + process.argv.slice(2).join(' '))
  process.exit(1)
}
console.log(answer)
`,
    )
    await chmod(file, 0o755)
  }

  const runBump = (root: string, args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      execFile(
        process.execPath,
        [SCRIPT, ...args],
        {
          cwd: root,
          env: {
            ...process.env,
            PATH: `${join(root, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
            // A dead registry: the fake npm ignores it, and a real npm must not be what answers.
            npm_config_registry: 'http://127.0.0.1:9',
          },
        },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
          resolve({ code, stdout, stderr })
        },
      )
    })

  const lockWithHost = () => ({
    name: '@lllzt/dsh-webui-framework',
    version: '0.0.0',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: '@lllzt/dsh-webui-framework', version: '0.0.0' },
      'node_modules/@deepseek-ai/dsh-web-app': {
        version: '0.2.2-alpha.2',
        resolved: 'https://example.test/dsh-web-app.tgz',
        integrity: 'sha512-web-app',
      },
      'node_modules/@deepseek-ai/dsh-client-store': {
        version: '0.2.2-alpha.2',
        resolved: 'https://example.test/store.tgz',
        integrity: 'sha512-store',
      },
      'node_modules/vitest': {
        version: '4.1.12',
        resolved: 'https://example.test/vitest.tgz',
        integrity: 'sha512-vitest',
      },
    },
  })

  const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

  const oneLine = (stdout: string) => {
    const line = stdout.trim()
    expect(line.split('\n')).toHaveLength(1)
    return JSON.parse(line) as { current: string; target: string; changed: boolean; relocked: boolean }
  }

  it('A3 --write reports relocked and prunes @deepseek-ai entries from package-lock.json', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-bump-'))
    await installFakeNpm(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest(), null, 2) + '\n')
    const lock = lockWithHost()
    await writeFile(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')

    const result = await runBump(dir, ['--version', '0.2.3-alpha.1', '--write'])

    expect(result.code, result.stderr).toBe(0)
    expect(oneLine(result.stdout)).toMatchObject({
      current: '0.2.2-alpha.2',
      target: '0.2.3-alpha.1',
      changed: true,
      relocked: true,
    })
    const written = await readJson(join(dir, 'package-lock.json'))
    const packages = written.packages as Record<string, { version?: string; resolved?: string; integrity?: string }>
    expect(Object.keys(packages).filter((key) => key.startsWith('node_modules/@deepseek-ai/'))).toEqual([])
    expect(packages['node_modules/vitest']).toEqual(lock.packages['node_modules/vitest'])
    expect(written.name).toBe(lock.name)
    expect(written.version).toBe(lock.version)
    expect(written.lockfileVersion).toBe(lock.lockfileVersion)
    expect(written.requires).toBe(true)
    const pkg = await readJson(join(dir, 'package.json'))
    const dev = pkg.devDependencies as Record<string, string>
    expect(dev['@deepseek-ai/dsh-web-app']).toBe('0.2.3-alpha.1')
    expect(dev['@deepseek-ai/dsh-client-store']).toBe('0.2.3-alpha.1')
    expect(dev.vitest).toBe('^4.1.12')
  })

  it('A3 --write reports relocked false and exits 0 when package-lock.json is absent', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-bump-'))
    await installFakeNpm(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest(), null, 2) + '\n')

    const result = await runBump(dir, ['--version', '0.2.3-alpha.1', '--write'])

    expect(result.code, result.stderr).toBe(0)
    expect(oneLine(result.stdout).relocked).toBe(false)
    await expect(readFile(join(dir, 'package-lock.json'), 'utf8')).rejects.toThrow()
  })

  it('A3 --write reports relocked false when the lockfile has nothing to prune', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-bump-'))
    await installFakeNpm(dir)
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest(), null, 2) + '\n')
    const lock = {
      name: 'app',
      version: '0.0.0',
      lockfileVersion: 3,
      packages: {
        '': { name: 'app', version: '0.0.0' },
        'node_modules/vitest': {
          version: '4.1.12',
          resolved: 'https://example.test/vitest.tgz',
          integrity: 'sha512-vitest',
        },
      },
    }
    await writeFile(join(dir, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n')

    const result = await runBump(dir, ['--version', '0.2.3-alpha.1', '--write'])

    expect(result.code, result.stderr).toBe(0)
    expect(oneLine(result.stdout).relocked).toBe(false)
    expect(await readJson(join(dir, 'package-lock.json'))).toEqual(lock)
  })

  it('A3 without --write writes nothing and reports relocked false', async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-bump-'))
    await installFakeNpm(dir)
    const pkgText = JSON.stringify(manifest(), null, 2) + '\n'
    const lock = lockWithHost()
    const lockText = JSON.stringify(lock, null, 2) + '\n'
    await writeFile(join(dir, 'package.json'), pkgText)
    await writeFile(join(dir, 'package-lock.json'), lockText)

    const result = await runBump(dir, ['--version', '0.2.3-alpha.1'])

    expect(result.code, result.stderr).toBe(0)
    expect(oneLine(result.stdout).relocked).toBe(false)
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toBe(pkgText)
    expect(await readFile(join(dir, 'package-lock.json'), 'utf8')).toBe(lockText)
  })
})
