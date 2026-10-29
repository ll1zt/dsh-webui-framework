import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SELF = 'scripts/framework-baseline.test.ts'

const DELETED = [
  'src/lib/session-rows.ts',
  'src/lib/session-rows.test.ts',
  'src/lib/lineage.ts',
  'src/lib/lineage.test.ts',
  'src/ui/shell/AppShell.tsx',
  'src/ui/shell/AppShell.test.tsx',
]

const REMOVED_DEPS = [
  'dsh-api-session-controller',
  'dsh-api-workspace-controller',
  'dsh-api-workspace-files',
  'dsh-client-file-upload',
  'dsh-client-resources',
  'dsh-client-ui-commands',
  'dsh-client-ui-input-trigger',
  'dsh-client-ui-layout',
  'dsh-client-ui-model-selection',
  'dsh-client-ui-settings',
  'dsh-client-ui-settings-general',
  'dsh-api-remotes',
].map((name) => `@deepseek-ai/${name}`)

const REMOVED_KEYS = ['blocks.files', 'blocks.session', 'blocks.sessions', 'blocks.viewer']

function listFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

function readLocale(lang: string): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, 'locale', `${lang}.json`), 'utf8'))
}

describe('框架基线：非框架代码与多余依赖已删除', () => {
  it('A1 非框架文件不存在，且 src 与 scripts 中没有对它们的引用', () => {
    expect(DELETED.filter((file) => existsSync(join(ROOT, file)))).toEqual([])

    const referrers = [...listFiles('src'), ...listFiles('scripts')]
      .map((file) => relative(ROOT, join(ROOT, file)))
      .filter((file) => file !== SELF && /\.(?:[cm]?[jt]sx?|css|json)$/.test(file))
      .filter((file) => /session-rows|lineage|AppShell/.test(readFileSync(join(ROOT, file), 'utf8')))
    expect(referrers).toEqual([])
  })

  it('A2 devDependencies 不含已卸载的 12 个包', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>
    }
    const present = REMOVED_DEPS.filter((name) => name in (pkg.devDependencies ?? {}))
    expect(present).toEqual([])
  })

  it('A3 zh 与 en 键集合相同，且都不含已删除的 blocks 键', () => {
    const zh = Object.keys(readLocale('zh')).sort()
    const en = Object.keys(readLocale('en')).sort()
    expect(zh).toEqual(en)
    expect([...zh, ...en].filter((key) => REMOVED_KEYS.includes(key))).toEqual([])
  })
})
