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
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** An exact version: no range operator, optional prerelease. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/

/** The only runtime dependency the Node half may declare (D38). */
const RUNTIME_ALLOW = ['@deepseek-ai/schemastery']

interface Step {
  id?: string
  name?: string
  if?: string
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

  it('A6 every @deepseek-ai/dsh-* package shares one exact version and cordis and schemastery are exact', () => {
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const host = Object.entries(all).filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
    expect(host.length).toBeGreaterThan(0)
    expect(host.filter(([, version]) => !EXACT_VERSION.test(version))).toEqual([])
    expect(new Set(host.map(([, version]) => version)).size).toBe(1)
    expect(all['@deepseek-ai/cordis']).toMatch(EXACT_VERSION)
    expect(all['@deepseek-ai/schemastery']).toMatch(EXACT_VERSION)
  })

  it('A6 dependencies lists only the Node half runtime allow-list', () => {
    const names = Object.keys(pkg.dependencies ?? {})
    expect(names.filter((name) => !RUNTIME_ALLOW.includes(name))).toEqual([])
  })

  it('A7 .gitignore anchors lib at the repo root so src/lib is not ignored', () => {
    const lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')
    expect(lines).toContain('/lib')
    expect(lines).not.toContain('lib')
  })
})

interface AlphaWorkflow {
  on: {
    schedule?: { cron?: string }[]
    workflow_dispatch?: { inputs?: Record<string, { required?: boolean }> }
  }
  jobs: Record<string, { steps: Step[] }>
}

/** Read lazily, so a missing workflow fails its own tests instead of the whole file. */
const loadAlpha = () => {
  const text = readFileSync(join(ROOT, '.forgejo/workflows/dsh-alpha.yml'), 'utf8')
  const alpha = parse(text) as AlphaWorkflow
  const steps = Object.values(alpha.jobs).flatMap((job) => job.steps)
  const indexOf = (...needles: string[]) =>
    steps.findIndex((step) => needles.every((needle) => (step.run ?? '').includes(needle)))
  return { text, alpha, steps, indexOf }
}

describe('dsh-alpha 工作流', () => {
  it('A5 runs weekly on schedule and can be dispatched with an optional version input', () => {
    const { alpha } = loadAlpha()
    expect(alpha.on.schedule?.[0]?.cron).toBe('0 3 * * 1')
    const version = alpha.on.workflow_dispatch?.inputs?.version
    expect(version).toBeDefined()
    expect(version?.required ?? false).toBe(false)
  })

  it('A5 steps run bump, install, gate, host-compat, then push and report in that order', () => {
    const { indexOf } = loadAlpha()
    const bump = indexOf('scripts/dsh-bump.ts')
    const install = indexOf('npm install')
    const gate = indexOf('npm run gate')
    const compat = indexOf('scripts/host-compat.ts')
    const push = indexOf('git', 'push', 'dsh-alpha/')
    const report = indexOf('scripts/dsh-report.ts')
    for (const index of [bump, install, gate, compat, push, report]) expect(index).toBeGreaterThanOrEqual(0)
    expect(bump).toBeLessThan(install)
    expect(install).toBeLessThan(gate)
    expect(gate).toBeLessThan(compat)
    expect(compat).toBeLessThan(push)
    expect(push).toBeLessThanOrEqual(report)
  })

  it('A5 a failed install, gate or host-compat step is reported by a failure() step that calls dsh-report', () => {
    const { steps, indexOf } = loadAlpha()
    const failure = steps.findIndex(
      (step) => (step.if ?? '').includes('failure()') && (step.run ?? '').includes('scripts/dsh-report.ts'),
    )
    expect(failure).toBeGreaterThan(indexOf('scripts/host-compat.ts'))
  })

  it('A5 every step after the bump depends on its changed output, and no change prints 没有新版本', () => {
    const { text, steps, indexOf } = loadAlpha()
    const bump = indexOf('scripts/dsh-bump.ts')
    const id = steps[bump]?.id
    expect(id).toBeTruthy()
    const after = steps.slice(bump + 1)
    expect(after.length).toBeGreaterThan(0)
    expect(after.filter((step) => !(step.if ?? '').includes(`steps.${id}.outputs.changed`))).toEqual([])
    expect(text).toContain('没有新版本')
  })
})
