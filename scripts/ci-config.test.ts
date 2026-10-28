import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const workflowText = readFileSync(join(ROOT, '.forgejo/workflows/ci.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
  engines?: { node?: string }
}

interface Step {
  name?: string
  run?: string
}
const workflow = parse(workflowText) as { jobs: Record<string, { steps: Step[] }> }
const runs = Object.values(workflow.jobs)
  .flatMap((job) => job.steps)
  .map((step) => step.run ?? '')

describe('npm run gate 是门禁唯一定义', () => {
  it('A1 scripts.gate 依次为 check、build、pack:check', () => {
    const parts = (pkg.scripts?.gate ?? '').split('&&').map((part) => part.trim())
    expect(parts).toEqual(['npm run check', 'npm run build', 'npm run pack:check'])
  })

  it('A2 CI 只有一个 gate 步骤，没有其它门禁步骤，也没有 --if-present', () => {
    expect(runs.filter((run) => run.includes('npm run gate'))).toHaveLength(1)
    const others = [
      'npm run typecheck',
      'npm run lint',
      'npm run test',
      'npm run build',
      'npm run check',
      'npm run pack:check',
    ]
    for (const other of others) {
      expect(
        runs.filter((run) => run.includes(other)),
        other,
      ).toEqual([])
    }
    expect(workflowText).not.toContain('--if-present')
  })

  it('A3 npm ci 步骤存在且在 gate 步骤之前', () => {
    const gate = runs.findIndex((run) => run.includes('npm run gate'))
    const install = runs.findIndex((run) => run.includes('npm ci'))
    expect(gate).toBeGreaterThanOrEqual(0)
    expect(install).toBeGreaterThanOrEqual(0)
    expect(install).toBeLessThan(gate)
  })

  it('A4 engines.node 为 >=<主版本>，主版本不低于 24', () => {
    const match = /^>=(\d+)$/.exec(pkg.engines?.node ?? '')
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(24)
  })
})
