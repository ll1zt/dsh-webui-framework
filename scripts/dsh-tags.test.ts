import { describe, expect, it } from 'vitest'
import { alreadyChecked, latestTargets, planChecks } from './dsh-tags.ts'

describe('latestTargets', () => {
  it('A1 returns each distinct version once, alpha then next then latest', () => {
    expect(latestTargets({ latest: '1.0.0', next: '1.0.0-rc.1', alpha: '1.0.0-alpha.1', beta: '9.9.9' })).toEqual([
      { tag: 'alpha', version: '1.0.0-alpha.1' },
      { tag: 'next', version: '1.0.0-rc.1' },
      { tag: 'latest', version: '1.0.0' },
    ])

    // First tag wins, so the shared version keeps alpha rather than latest.
    expect(latestTargets({ latest: '1.2.3', next: '1.2.3', alpha: '1.2.3' })).toEqual([
      { tag: 'alpha', version: '1.2.3' },
    ])
    expect(latestTargets({ alpha: '1.0.0', next: '1.0.0-rc.1', latest: '1.0.0' })).toEqual([
      { tag: 'alpha', version: '1.0.0' },
      { tag: 'next', version: '1.0.0-rc.1' },
    ])
  })

  it('A1 skips a missing tag and ignores an empty version', () => {
    expect(latestTargets({ alpha: '1.0.0-alpha.1', latest: '1.0.0' })).toEqual([
      { tag: 'alpha', version: '1.0.0-alpha.1' },
      { tag: 'latest', version: '1.0.0' },
    ])
    expect(latestTargets({ latest: '2.0.0' })).toEqual([{ tag: 'latest', version: '2.0.0' }])
    expect(latestTargets({ alpha: '', next: '1.0.0-rc.1', latest: '' })).toEqual([
      { tag: 'next', version: '1.0.0-rc.1' },
    ])
    expect(latestTargets({})).toEqual([])
  })
})

describe('alreadyChecked', () => {
  const failure = 'dsh 0.2.2-rc.1：兼容性检查失败'
  const upgrade = '升级到 dsh 0.2.2-rc.1'

  it('A2 matches a dsh version token and does not cross a version boundary', () => {
    expect(alreadyChecked([failure], '0.2.2-rc.1')).toBe(true)
    expect(alreadyChecked([upgrade], '0.2.2-rc.1')).toBe(true)
    expect(alreadyChecked(['其他标题', upgrade], '0.2.2-rc.1')).toBe(true)
    // A later real token still counts when an earlier prefix is only a longer version.
    expect(alreadyChecked(['dsh 0.2.2-rc.10 与 dsh 0.2.2-rc.1：兼容性检查失败'], '0.2.2-rc.1')).toBe(true)

    expect(alreadyChecked([failure], '0.2.2-rc.10')).toBe(false)
    expect(alreadyChecked([failure], '0.2.2')).toBe(false)
    expect(alreadyChecked([failure, upgrade], '0.2.2-alpha.2')).toBe(false)
    expect(alreadyChecked(['dsh 0.2.2-rc.10：兼容性检查失败'], '0.2.2-rc.1')).toBe(false)
    expect(alreadyChecked(['升级到 dsh 0.2.2-rc.10'], '0.2.2-rc.1')).toBe(false)
    expect(alreadyChecked(['chore: bump vitest'], '0.2.2-rc.1')).toBe(false)
    expect(alreadyChecked(['0.2.2-rc.1：兼容性检查失败'], '0.2.2-rc.1')).toBe(false)
    expect(alreadyChecked([], '0.2.2-rc.1')).toBe(false)
  })

  it('A2 planChecks drops a version already checked and keeps the rest in order', () => {
    const tags = { latest: '0.2.2', alpha: '0.2.2-alpha.2', next: '0.2.2-rc.1' }

    expect(planChecks(tags, [failure])).toEqual([
      { tag: 'alpha', version: '0.2.2-alpha.2' },
      { tag: 'latest', version: '0.2.2' },
    ])
    expect(planChecks(tags, ['升级到 dsh 0.2.2-alpha.2'])).toEqual([
      { tag: 'next', version: '0.2.2-rc.1' },
      { tag: 'latest', version: '0.2.2' },
    ])
    expect(
      planChecks({ alpha: '0.2.2-alpha.2', latest: '0.2.2' }, [
        'dsh 0.2.2-alpha.2：兼容性检查失败',
        '升级到 dsh 0.2.2',
      ]),
    ).toEqual([])
  })
})
