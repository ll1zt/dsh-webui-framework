import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const NEW_NAME = '@lllzt/dsh-webui-framework'
// split so this file does not itself match the search
const OLD_NAME = '@lllzt/dsh-' + 'web-ui'

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8')

describe('rename to @lllzt/dsh-webui-framework', () => {
  it('A1 the old package name appears nowhere outside ref, docs and lib', () => {
    let out = ''
    try {
      out = execFileSync('git', ['grep', '-l', OLD_NAME, '--', '.', ':!ref', ':!docs', ':!lib'], {
        cwd: ROOT,
        encoding: 'utf8',
      })
    } catch (error) {
      // git grep exits 1 when nothing matches, which is the wanted result
      if ((error as { status?: number }).status !== 1) throw error
    }
    expect(out.trim()).toBe('')
  })

  it('A2 cordis.patch.yml, package.json and PLUGIN_ID all use the new name', () => {
    const patch = parse(read('cordis.patch.yml')) as Array<{ insert?: Array<{ name?: string }> }>
    const inserted = patch.flatMap((entry) => entry.insert ?? []).map((row) => row.name)
    expect(inserted).toEqual([NEW_NAME])
    expect((JSON.parse(read('package.json')) as { name: string }).name).toBe(NEW_NAME)
    expect(read('scripts/plugin-constants.ts')).toMatch(
      new RegExp(`export const PLUGIN_ID = '${NEW_NAME.replace(/[/.]/g, '\\$&')}'`),
    )
  })
})
