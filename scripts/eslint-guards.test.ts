import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: ROOT })

/** How many `no-restricted-syntax` reports the repository config gives `text` when it lives at `rel`. */
async function restricted(text: string, rel: string): Promise<number> {
  const [result] = await eslint.lintText(text, { filePath: join(ROOT, rel) })
  return (result?.messages ?? []).filter((message) => message.ruleId === 'no-restricted-syntax').length
}

describe('eslint single-exit guards', () => {
  it('A1 a dsh-web-ui: literal is reported everywhere except the key module and tests', async () => {
    const literal = "export const k = 'dsh-web-ui:x'"
    expect(await restricted(literal, 'src/ui/x.ts')).toBeGreaterThanOrEqual(1)
    expect(await restricted(literal, 'src/client/x.ts')).toBeGreaterThanOrEqual(1)
    expect(await restricted(literal, 'src/lib/storage-keys.ts')).toBe(0)
    expect(await restricted(literal, 'src/ui/x.test.ts')).toBe(0)
  })

  it('A1 a template string starting with dsh-web-ui: is reported too', async () => {
    const template = 'export const k = (a: string) => `dsh-web-ui:${a}`'
    expect(await restricted(template, 'src/ui/x.ts')).toBeGreaterThanOrEqual(1)
    expect(await restricted(template, 'src/lib/storage-keys.ts')).toBe(0)
    expect(await restricted(template, 'src/ui/x.test.ts')).toBe(0)
  })

  it('A1 a comment mentioning dsh-web-ui: is not a literal', async () => {
    expect(await restricted("// 'dsh-web-ui:x' lives in storage-keys\nexport const k = 1", 'src/ui/x.ts')).toBe(0)
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
})
