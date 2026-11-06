import { describe, expect, it } from 'vitest'
import { pruneDshEntries } from './dsh-relock.ts'
import type { PackageLock } from './dsh-relock.ts'

/** Lockfile keys npm would have to re-resolve: direct `@deepseek-ai/*` installs, including nested ones. */
const HOST_PREFIX = 'node_modules/@deepseek-ai/'

const pkg = (version: string, resolved: string, integrity: string) => ({ version, resolved, integrity })

describe('pruneDshEntries', () => {
  it('A1 drops every @deepseek-ai entry, keeps the others in order with counts, and does not mutate the input', () => {
    const vitest = pkg('4.1.12', 'https://example.test/vitest-4.1.12.tgz', 'sha512-vitest')
    const nearMiss = pkg('1.2.3', 'https://example.test/extra-1.2.3.tgz', 'sha512-extra')
    const nestedHost = pkg('9.9.9', 'https://example.test/cordis-nested.tgz', 'sha512-nested-host')
    const lock: PackageLock = {
      name: '@lllzt/dsh-webui-framework',
      version: '0.4.0',
      lockfileVersion: 3,
      requires: true,
      packages: {
        '': { name: '@lllzt/dsh-webui-framework', version: '0.4.0' },
        'node_modules/@deepseek-ai/dsh-web-app': pkg(
          '0.2.2-alpha.2',
          'https://example.test/dsh-web-app-0.2.2-alpha.2.tgz',
          'sha512-old-app',
        ),
        'node_modules/vitest': vitest,
        'node_modules/@deepseek-ai/dsh-web-app/node_modules/left-pad': pkg(
          '1.0.0',
          'https://example.test/left-pad-1.0.0.tgz',
          'sha512-left',
        ),
        // Same scope spelling, but not the `@deepseek-ai/` prefix — must stay.
        'node_modules/@deepseek-ai-extra/pkg': nearMiss,
        // A host package nested under something else does not start with the prefix — must stay.
        'node_modules/vitest/node_modules/@deepseek-ai/cordis': nestedHost,
        'node_modules/@deepseek-ai/cordis': pkg(
          '4.0.6-alpha.1',
          'https://example.test/cordis-4.0.6-alpha.1.tgz',
          'sha512-cordis',
        ),
      },
    }
    const before = structuredClone(lock)
    const keys = Object.keys(lock.packages ?? {})
    const stayed = keys.filter((key) => !key.startsWith(HOST_PREFIX))

    const result = pruneDshEntries(lock)

    expect(result.pruned).toBe(keys.length - stayed.length)
    expect(result.kept).toBe(stayed.length)
    expect(Object.keys(result.lock.packages ?? {})).toEqual(stayed)
    expect(result.lock.packages?.['node_modules/vitest']).toEqual(vitest)
    expect(result.lock.packages?.['node_modules/@deepseek-ai-extra/pkg']).toEqual(nearMiss)
    expect(result.lock.packages?.['node_modules/vitest/node_modules/@deepseek-ai/cordis']).toEqual(nestedHost)
    expect(result.lock.packages?.['node_modules/@deepseek-ai/dsh-web-app']).toBeUndefined()
    expect(result.lock.packages?.['node_modules/@deepseek-ai/dsh-web-app/node_modules/left-pad']).toBeUndefined()
    expect(result.lock.name).toBe(before.name)
    expect(result.lock.version).toBe(before.version)
    expect(result.lock.lockfileVersion).toBe(before.lockfileVersion)
    expect(result.lock.requires).toBe(true)
    expect(lock).toEqual(before)
    expect(lock.packages?.['node_modules/vitest']).toBe(vitest)
  })

  it('A2 keeps each unrelated version, resolved and integrity string when host entries are pruned', () => {
    // Miniature of the bad full relock: dsh-web-app's manifest range is already the target, the other
    // host packages are still on the old version, and a non-@deepseek-ai range was edited. Prune is the
    // stand-in for "reinstall": it only drops `@deepseek-ai/*` lock entries, so the unrelated ones
    // (version, resolved, integrity) stay byte-for-byte what they were. No npm and no network.
    const vitest = pkg('4.1.12', 'https://example.test/vitest/-/vitest-4.1.12.tgz', 'sha512-VitestUNCHANGED+abc=')
    const react = pkg('18.3.1', 'https://example.test/react/-/react-18.3.1.tgz', 'sha512-ReactUNCHANGED+def=')
    const yaml = pkg('2.9.1', 'https://example.test/yaml/-/yaml-2.9.1.tgz', 'sha512-YamlWasNotBumped+ghi=')
    const root = {
      name: '@lllzt/dsh-webui-framework',
      version: '0.4.0',
      dependencies: { '@deepseek-ai/schemastery': '3.18.6-alpha.1' },
      devDependencies: {
        '@deepseek-ai/dsh-web-app': '0.2.3-alpha.1',
        '@deepseek-ai/dsh-client-store': '0.2.2-alpha.2',
        '@deepseek-ai/cordis': '4.0.6-alpha.1',
        vitest: '^4.9.0',
      },
    }
    const lock: PackageLock = {
      name: '@lllzt/dsh-webui-framework',
      version: '0.4.0',
      lockfileVersion: 3,
      packages: {
        '': root,
        'node_modules/@deepseek-ai/dsh-web-app': pkg(
          '0.2.2-alpha.2',
          'https://example.test/@deepseek-ai/dsh-web-app/-/dsh-web-app-0.2.2-alpha.2.tgz',
          'sha512-old-web-app',
        ),
        'node_modules/vitest': vitest,
        'node_modules/@deepseek-ai/dsh-client-store': pkg(
          '0.2.2-alpha.2',
          'https://example.test/@deepseek-ai/dsh-client-store/-/dsh-client-store-0.2.2-alpha.2.tgz',
          'sha512-old-store',
        ),
        'node_modules/@deepseek-ai/cordis': pkg(
          '4.0.6-alpha.1',
          'https://example.test/@deepseek-ai/cordis/-/cordis-4.0.6-alpha.1.tgz',
          'sha512-old-cordis',
        ),
        'node_modules/react': react,
        'node_modules/yaml': yaml,
      },
    }
    const original = structuredClone(lock)

    const { lock: pruned } = pruneDshEntries(lock)

    const unrelated = ['', 'node_modules/vitest', 'node_modules/react', 'node_modules/yaml'] as const
    for (const key of unrelated) {
      const before = original.packages?.[key]
      const after = pruned.packages?.[key]
      expect(after, key).toEqual(before)
      expect(after?.version, key).toBe(before?.version)
      expect(after?.resolved, key).toBe(before?.resolved)
      expect(after?.integrity, key).toBe(before?.integrity)
    }
    expect(pruned.packages?.['node_modules/vitest']?.version).toBe('4.1.12')
    expect(pruned.packages?.['node_modules/vitest']?.integrity).toBe('sha512-VitestUNCHANGED+abc=')
    expect(pruned.packages?.['node_modules/@deepseek-ai/dsh-web-app']).toBeUndefined()
    expect(pruned.packages?.['node_modules/@deepseek-ai/dsh-client-store']).toBeUndefined()
    expect(pruned.packages?.['node_modules/@deepseek-ai/cordis']).toBeUndefined()
    expect(lock).toEqual(original)
  })
})
