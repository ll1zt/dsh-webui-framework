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

interface AlphaJob {
  needs?: string | string[]
  outputs?: Record<string, unknown>
  strategy?: { matrix?: Record<string, unknown> }
  steps: Step[]
}

interface AlphaWorkflow {
  on: {
    schedule?: { cron?: string }[]
    workflow_dispatch?: { inputs?: Record<string, { required?: boolean }> }
  }
  jobs: Record<string, AlphaJob>
}

const needsOf = (needs: AlphaJob['needs']): string[] => {
  if (typeof needs === 'string') return [needs]
  if (Array.isArray(needs)) return needs
  return []
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
  it('A5 runs daily on schedule and can be dispatched with an optional version input', () => {
    const { alpha } = loadAlpha()
    expect(alpha.on.schedule?.map((entry) => entry.cron)).toEqual(['0 3 * * *'])
    const version = alpha.on.workflow_dispatch?.inputs?.version
    expect(version).toBeDefined()
    expect(version?.required ?? false).toBe(false)
  })

  // Guard id is this exact title. It cannot also match the A<n> title prefix.
  // eslint-disable-next-line no-restricted-syntax
  it('A4:A5 steps run bump, install, gate, host-compat, then push and report in that order', () => {
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

  it('A3 dsh-alpha install runs one npm install, does not delete the lockfile, and notes the prune', () => {
    const { text, steps, indexOf } = loadAlpha()
    const bump = indexOf('scripts/dsh-bump.ts')
    const install = steps.findIndex((step) => step.name === 'npm install')
    const gate = indexOf('npm run gate')
    expect(bump).toBeGreaterThanOrEqual(0)
    expect(install).toBeGreaterThan(bump)
    expect(gate).toBeGreaterThan(install)

    const run = steps[install]?.run ?? ''
    expect(run.match(/npm install/g)).toEqual(['npm install'])
    expect(run).toContain('npm install --include=dev --ignore-scripts')
    expect(run).not.toMatch(/\brm\b/)
    expect(run).not.toContain('package-lock.json')
    // Prune happens in the bump, so the workflow has to pass --write or the lock is never trimmed.
    expect(steps[bump]?.run ?? '').toContain('--write')

    const at = text.indexOf('- name: npm install')
    const gateAt = text.indexOf('- name: gate', at)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(gateAt).toBeGreaterThan(at)
    const regionStart = text.lastIndexOf('\n\n', at)
    expect(regionStart).toBeGreaterThanOrEqual(0)
    const region = text.slice(regionStart, gateAt)
    expect(region).toContain('npm install')
    // The bump step owns "没有新版本"; this slice is only the install step and the comment above it.
    expect(region).not.toContain('没有新版本')
    expect(region).toMatch(/prune|裁剪|@deepseek-ai|删掉|删除/i)
  })

  it('A3 install redirects npm output to a log the failure report passes, and git add does not include it', () => {
    const { text, steps } = loadAlpha()
    const installRun = steps.find((step) => step.name === 'npm install')?.run ?? ''
    const reportRun = steps.find((step) => step.name === 'Report failure')?.run ?? ''

    expect(installRun).toContain('npm install')
    expect(installRun).toMatch(/(?:>\s*["']?npm-install\.log|tee\b[^\n]*npm-install\.log)/)
    expect(reportRun).toContain('scripts/dsh-report.ts')
    expect(reportRun).toContain('--npm-log')
    expect(reportRun).toContain('npm-install.log')

    const gitAdds = text.split('\n').filter((line) => line.includes('git add'))
    expect(gitAdds.length).toBeGreaterThan(0)
    for (const line of gitAdds) {
      expect(line).not.toContain('npm-install.log')
      expect(line).not.toMatch(/git add\s+(?:-A|--all|\.)\b/)
    }
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

  it('A3 schedule is daily, a plan job feeds a version matrix, and dispatch version still works', () => {
    const { text, alpha } = loadAlpha()
    expect(alpha.on.schedule?.map((entry) => entry.cron)).toEqual(['0 3 * * *'])
    const version = alpha.on.workflow_dispatch?.inputs?.version
    expect(version).toBeDefined()
    expect(version?.required ?? false).toBe(false)

    const plan = alpha.jobs.plan
    expect(plan).toBeDefined()
    expect(plan?.steps.some((step) => (step.run ?? '').includes('scripts/dsh-checked.ts'))).toBe(true)
    expect(JSON.stringify(plan)).toContain('github.event.inputs.version')
    expect(JSON.stringify(plan?.outputs)).toContain('versions')

    const matrixJobs = Object.entries(alpha.jobs).filter(([, job]) => job.strategy?.matrix !== undefined)
    expect(matrixJobs).toHaveLength(1)
    const matrix = matrixJobs[0]?.[1]
    expect(needsOf(matrix?.needs)).toContain('plan')
    expect(JSON.stringify(matrix?.strategy)).toContain('needs.plan.outputs.versions')
    expect(text).toContain('needs.plan.outputs.versions')

    const steps = matrix?.steps ?? []
    const indexOf = (...needles: string[]) =>
      steps.findIndex((step) => needles.every((needle) => (step.run ?? '').includes(needle)))
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

    const bumpStep = steps[bump]
    expect(JSON.stringify(bumpStep)).toContain('matrix.version')
    expect(JSON.stringify(bumpStep)).not.toContain('github.event.inputs.version')
    const id = bumpStep?.id
    expect(id).toBeTruthy()
    const after = steps.slice(bump + 1)
    expect(after.length).toBeGreaterThan(0)
    expect(after.filter((step) => !(step.if ?? '').includes(`steps.${id}.outputs.changed`))).toEqual([])
  })

  it('A3 smoke runs after host-compat and before push, and a smoke failure is reported as smoke', () => {
    const { text, steps, indexOf } = loadAlpha()
    const gate = indexOf('npm run gate')
    const compat = indexOf('scripts/host-compat.ts')
    const push = indexOf('git', 'push', 'dsh-alpha/')
    const smoke = steps.findIndex(
      (step) => (step.run ?? '').includes('scripts/host-run.ts') && (step.run ?? '').includes('scripts/host-smoke.ts'),
    )
    expect(gate).toBeGreaterThanOrEqual(0)
    expect(compat).toBeGreaterThanOrEqual(0)
    expect(push).toBeGreaterThanOrEqual(0)
    expect(smoke).toBeGreaterThan(gate)
    expect(smoke).toBeGreaterThan(compat)
    expect(smoke).toBeLessThan(push)

    const step = steps[smoke]
    expect(step?.if ?? '').toContain('steps.bump.outputs.changed')
    const body = JSON.stringify(step)
    expect(body).toContain('npm install')
    expect(body).toContain('--prefix')
    expect(body).toContain('.host-dsh')
    expect(body).toContain('--ignore-scripts')
    expect(body).toMatch(/@deepseek-ai\/dsh[@=]/)
    expect(
      body.includes('matrix.version') || body.includes('DSH_VERSION') || body.includes('steps.bump.outputs.version'),
    ).toBe(true)
    expect(body).toContain('npm pack')
    expect(body.includes('DSH_HOME') || body.includes('--home')).toBe(true)
    expect(body).toContain('scripts/host-run.ts')
    expect(body).toContain('scripts/host-smoke.ts')

    const id = step?.id
    expect(id).toBeTruthy()
    const report = steps.find((item) => item.name === 'Report failure')
    expect(report?.if ?? '').toContain(`steps.${id}.outcome`)
    expect(report?.run ?? '').toMatch(/DSH_FAILED_STEP=["']?smoke["']?/)

    const gitAdds = text.split('\n').filter((line) => line.includes('git add'))
    expect(gitAdds.length).toBeGreaterThan(0)
    for (const line of gitAdds) expect(line).not.toContain('.host-dsh')
  })
})

/** Advance past one Nix string literal (`"..."` or `''...''`) starting at `index`. */
function skipNixString(source: string, index: number): number {
  if (source.startsWith("''", index)) {
    let cursor = index + 2
    while (cursor < source.length) {
      if (source.startsWith("'''", cursor) || source.startsWith("''\\", cursor)) cursor += 3
      else if (source.startsWith("''", cursor)) return cursor + 2
      else cursor += 1
    }
    return cursor
  }
  let cursor = index + 1
  while (cursor < source.length) {
    if (source[cursor] === '\\') cursor += 2
    else if (source[cursor] === '"') return cursor + 1
    else cursor += 1
  }
  return cursor
}

/** Strip Nix `#` line comments and block comments while keeping string literals intact. */
function stripNixComments(source: string): string {
  let out = ''
  let cursor = 0
  while (cursor < source.length) {
    if (source[cursor] === '"' || source.startsWith("''", cursor)) {
      const end = skipNixString(source, cursor)
      out += source.slice(cursor, end)
      cursor = end
    } else if (source[cursor] === '#') {
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1
    } else if (source.startsWith('/*', cursor)) {
      const end = source.indexOf('*/', cursor + 2)
      cursor = end === -1 ? source.length : end + 2
      out += ' '
    } else {
      out += source[cursor]
      cursor += 1
    }
  }
  return out
}

/** Extract the RHS expression of `name = ...;` from comment-free Nix source, ignoring string contents. */
function nixBinding(source: string, name: string): string | undefined {
  let cursor = 0
  let start = -1
  while (cursor < source.length) {
    if (source[cursor] === '"' || source.startsWith("''", cursor)) {
      cursor = skipNixString(source, cursor)
      continue
    }
    if (source.startsWith(name, cursor)) {
      const prev = cursor === 0 ? '' : (source[cursor - 1] ?? '')
      if (!/[A-Za-z0-9_'.-]/.test(prev)) {
        const eq = /^\s*=(?!=)/.exec(source.slice(cursor + name.length))
        if (eq !== null) {
          start = cursor + name.length + eq[0].length
          break
        }
      }
    }
    cursor += 1
  }
  if (start === -1) return undefined

  let depth = 0
  let end = start
  while (end < source.length) {
    const ch = source[end]
    if (ch === '"' || source.startsWith("''", end)) {
      end = skipNixString(source, end)
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') depth += 1
    else if (ch === '}' || ch === ')' || ch === ']') {
      if (depth === 0) break
      depth -= 1
    } else if (ch === ';' && depth === 0) {
      const prefix = source.slice(start, end).trimStart()
      if (/^with\b/.test(prefix) && !prefix.includes('[')) {
        end += 1
        continue
      }
      return source.slice(start, end)
    }
    end += 1
  }
  return undefined
}

describe('flake.nix', () => {
  it('A1 devShells.default packages includes pnpm', () => {
    const flake = stripNixComments(readFileSync(join(ROOT, 'flake.nix'), 'utf8'))
    const devShells = nixBinding(flake, 'devShells')
    expect(devShells).toBeDefined()
    const defaultShell = nixBinding(devShells ?? '', 'default')
    expect(defaultShell).toBeDefined()
    const packages = nixBinding(defaultShell ?? '', 'packages')
    expect(packages).toBeDefined()
    expect(packages).toMatch(/\[[\s\S]*\]/)
    expect(packages).toMatch(/(?:^|[\s[(.])pnpm(?:_[0-9]+)?(?=[\s\]).;]|$)/)
  })
})
