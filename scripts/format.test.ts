import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { check, getFileInfo, resolveConfig } from 'prettier'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('repository formatting', () => {
  it('A1 every tracked file prettier supports and .prettierignore keeps is formatted per the repo config', async () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean)
    const unformatted: string[] = []
    let checked = 0
    for (const name of tracked) {
      const file = resolve(ROOT, name)
      const info = await getFileInfo(file, { ignorePath: resolve(ROOT, '.prettierignore') })
      if (info.ignored || info.inferredParser === null) continue
      const config = await resolveConfig(file)
      checked += 1
      if (!(await check(readFileSync(file, 'utf8'), { ...config, filepath: file }))) unformatted.push(name)
    }
    expect(checked).toBeGreaterThan(0)
    expect(unformatted).toEqual([])
  }, 120_000)
})
