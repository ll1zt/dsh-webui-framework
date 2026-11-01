import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })

/** The lines of the `no-restricted-syntax` reports the repository config gives `text` when it lives at `rel`. */
async function restrictedLines(text: string, rel: string): Promise<number[]> {
  const [result] = await eslint.lintText(text, { filePath: join(ROOT, rel) })
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-syntax')
    .map((message) => message.line)
}

/** How many `no-restricted-syntax` reports the repository config gives `text` when it lives at `rel`. */
async function restricted(text: string, rel: string): Promise<number> {
  return (await restrictedLines(text, rel)).length
}

describe('eslint single-exit guards', () => {
  it('A1 a test title not starting with A<n> is reported, A<n> titles are not, non-test files are skipped', async () => {
    expect(await restricted("it('TestFoo_A1 does x', () => {})", 'src/x.test.ts')).toBeGreaterThanOrEqual(1)
    expect(await restricted("it('A1 does x', () => {})", 'src/x.test.ts')).toBe(0)
    expect(await restricted("test('A12 y', () => {})", 'src/x.test.ts')).toBe(0)
    expect(await restricted("it('TestFoo_A1 does x', () => {})", 'src/x.ts')).toBe(0)
  })

  it('A2 the plugin id literal is reported outside scripts/plugin-constants.ts and tests', async () => {
    const literal = "export const id = '@lllzt/dsh-webui-framework'"
    for (const rel of ['scripts/foo.ts', 'tsdown.config.ts', 'src/client/x.ts']) {
      expect(await restricted(literal, rel), rel).toBeGreaterThanOrEqual(1)
    }
    expect(await restricted(literal, 'scripts/plugin-constants.ts')).toBe(0)
    expect(await restricted(literal, 'scripts/foo.test.ts')).toBe(0)
  })

  it('A2 the seed sentinel literal is reported outside scripts/plugin-constants.ts and tests', async () => {
    const literal = "export const seed = '@deepseek-ai/dsh-client-ui-dockkit'"
    for (const rel of ['scripts/foo.ts', 'tsdown.config.ts', 'src/client/x.ts']) {
      expect(await restricted(literal, rel), rel).toBeGreaterThanOrEqual(1)
    }
    expect(await restricted(literal, 'scripts/plugin-constants.ts')).toBe(0)
    expect(await restricted(literal, 'scripts/foo.test.ts')).toBe(0)
  })

  it('A2 an import of the sentinel module is not a literal use', async () => {
    const text = "import type {} from '@deepseek-ai/dsh-client-ui-dockkit'\nexport const k = 1"
    expect(await restricted(text, 'src/client/x.ts')).toBe(0)
  })

  it('A2 a local deepFreeze in a test file is reported on its line; the shared module and an import are not', async () => {
    const declaration = 'function deepFreeze<T>(value: T): T { return value }'
    const variable = 'const deepFreeze = <T,>(value: T): T => value'

    expect(await restrictedLines(`import {} from 'vitest'\n${declaration}`, 'src/x.test.ts')).toEqual([2])
    expect(await restrictedLines(`import {} from 'vitest'\n\n${variable}`, 'src/x.test.ts')).toEqual([3])
    expect(await restricted(declaration, 'src/test/deep-freeze.ts')).toBe(0)
    expect(await restricted(variable, 'src/test/deep-freeze.ts')).toBe(0)

    const imported = "import { deepFreeze } from '../test/deep-freeze.ts'\nexport const frozen = deepFreeze({})"
    expect(await restricted(imported, 'src/x.test.ts')).toBe(0)
  })

  it('A8 the webui. literal is exempt in src/lib/layout-commands.ts only', async () => {
    const literal = "export const id = 'webui.tab.close'"
    expect(await restricted(literal, 'src/lib/layout-commands.ts')).toBe(0)
    for (const rel of ['src/lib/other.ts', 'src/client/x.ts']) {
      expect(await restricted(literal, rel), rel).toBeGreaterThanOrEqual(1)
    }
  })

  it('A8 the plugin id guard still applies in src/lib/layout-commands.ts', async () => {
    const literal = "export const id = '@lllzt/dsh-webui-framework'"
    expect(await restricted(literal, 'src/lib/layout-commands.ts')).toBeGreaterThanOrEqual(1)
  })
})
