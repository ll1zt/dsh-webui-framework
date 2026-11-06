import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reportRun } from './dsh-report.ts'
import type { DshRunOutcome } from './dsh-report.ts'

const TOKEN = '{{SECRET_k3m8q2x7}}'
const BASE = 'https://forge.test:3000'
const REPO = 'lllzt/dsh-webui-framework'
const API = `/api/v1/repos/${REPO}`
const VERSION = '0.2.3-alpha.1'
const BRANCH = `dsh-alpha/${VERSION}`
const ISSUE_TITLE = `dsh ${VERSION}：兼容性检查失败`
const PR_TITLE = `升级到 dsh ${VERSION}`
const RUN_URL = 'https://forge.test:3000/lllzt/dsh-webui-framework/actions/runs/42'

interface Issue {
  number: number
  title: string
  state: 'open' | 'closed'
}
interface Pull {
  number: number
  state: 'open' | 'closed'
  head: { ref: string }
}
interface Recorded {
  method: string
  path: string
  query: URLSearchParams
  authorization: string | null
  body: Record<string, unknown> | undefined
}

/** A small Forgejo: the issue and pull lists the reporter reads, plus the creates and comments it writes. */
const fakeForge = (state: { issues?: Issue[]; pulls?: Pull[]; failWith?: number } = {}) => {
  const issues = state.issues ?? []
  const pulls = state.pulls ?? []
  const requests: Recorded[] = []
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const rawBody = typeof init?.body === 'string' ? init.body : undefined
    const body = rawBody === undefined ? undefined : (JSON.parse(rawBody) as Record<string, unknown>)
    const authorization = new Headers(init?.headers).get('authorization')
    requests.push({ method, path: url.pathname, query: url.searchParams, authorization, body })
    if (state.failWith !== undefined && method !== 'GET') return json(state.failWith, { message: 'boom' })
    const open = url.searchParams.get('state') === 'open'
    if (method === 'GET' && url.pathname === `${API}/issues`) {
      return json(
        200,
        issues.filter((issue) => !open || issue.state === 'open'),
      )
    }
    if (method === 'GET' && url.pathname === `${API}/pulls`) {
      return json(
        200,
        pulls.filter((pull) => !open || pull.state === 'open'),
      )
    }
    if (method === 'POST' && url.pathname === `${API}/issues`) {
      const issue: Issue = { number: 100 + issues.length, title: String(body?.title), state: 'open' }
      issues.push(issue)
      return json(201, issue)
    }
    if (method === 'POST' && /^\/api\/v1\/repos\/[^/]+\/[^/]+\/issues\/\d+\/comments$/.test(url.pathname)) {
      return json(201, { id: 1 })
    }
    if (method === 'POST' && url.pathname === `${API}/pulls`) {
      const pull: Pull = { number: 200 + pulls.length, state: 'open', head: { ref: String(body?.head) } }
      pulls.push(pull)
      return json(201, pull)
    }
    return json(404, { message: 'not found' })
  }
  const forge = { baseUrl: BASE, repo: REPO, token: TOKEN, fetch: fetchImpl as typeof fetch }
  const writes = () => requests.filter((request) => request.method !== 'GET')
  return { forge, requests, writes, issues, pulls }
}

const failed = (step: 'install' | 'gate' | 'host-compat'): DshRunOutcome => ({
  ok: false,
  version: VERSION,
  step,
  runUrl: RUN_URL,
})
const passed: DshRunOutcome = { ok: true, version: VERSION, branch: BRANCH }

describe('reportRun on failure', () => {
  // Guard id is this exact title. It cannot also match the A<n> title prefix.
  // eslint-disable-next-line no-restricted-syntax
  it('A4:A3 opens an issue with the failed step and the run link when none with that title is open', async () => {
    const fake = fakeForge({
      issues: [
        { number: 3, title: '另一个问题', state: 'open' },
        { number: 4, title: ISSUE_TITLE, state: 'closed' },
      ],
    })

    const result = await reportRun(failed('host-compat'), fake.forge)

    expect(result.action).toBe('issue-created')
    const writes = fake.writes()
    expect(writes).toHaveLength(1)
    expect(writes[0]?.method).toBe('POST')
    expect(writes[0]?.path).toBe(`${API}/issues`)
    expect(writes[0]?.body?.title).toBe(ISSUE_TITLE)
    expect(String(writes[0]?.body?.body)).toContain('host-compat')
    expect(String(writes[0]?.body?.body)).toContain(RUN_URL)
    expect(result.number).toBe(
      fake.issues.find((issue) => issue.title === ISSUE_TITLE && issue.state === 'open')?.number,
    )
    const list = fake.requests.find((request) => request.method === 'GET' && request.path === `${API}/issues`)
    expect(list?.query.get('state')).toBe('open')
    expect(list?.query.get('type')).toBe('issues')
  })

  it('A3 names each failing step in the issue body', async () => {
    for (const step of ['install', 'gate', 'host-compat'] as const) {
      const fake = fakeForge()
      await reportRun(failed(step), fake.forge)
      expect(String(fake.writes()[0]?.body?.body), step).toContain(step)
    }
  })

  it('A3 only comments on an open issue that already has the title, without creating another', async () => {
    const fake = fakeForge({
      issues: [
        { number: 3, title: '另一个问题', state: 'open' },
        { number: 7, title: ISSUE_TITLE, state: 'open' },
      ],
    })

    const result = await reportRun(failed('gate'), fake.forge)

    expect(result).toEqual({ action: 'issue-commented', number: 7 })
    const writes = fake.writes()
    expect(writes).toHaveLength(1)
    expect(writes[0]?.method).toBe('POST')
    expect(writes[0]?.path).toBe(`${API}/issues/7/comments`)
    expect(String(writes[0]?.body?.body)).toContain('gate')
    expect(String(writes[0]?.body?.body)).toContain(RUN_URL)
    expect(fake.issues).toHaveLength(2)
  })

  it('A3 reporting the same failure twice leaves exactly one issue', async () => {
    const fake = fakeForge()

    const first = await reportRun(failed('install'), fake.forge)
    const second = await reportRun(failed('gate'), fake.forge)

    expect(first.action).toBe('issue-created')
    expect(second).toEqual({ action: 'issue-commented', number: first.number })
    expect(fake.issues.filter((issue) => issue.title === ISSUE_TITLE)).toHaveLength(1)
  })

  it('A3 sends the token only in the Authorization header, and a failing API call does not leak it', async () => {
    const ok = fakeForge()
    await reportRun(failed('gate'), ok.forge)
    for (const request of ok.requests) {
      expect(request.authorization).toContain(TOKEN)
      expect(request.path + request.query.toString() + JSON.stringify(request.body ?? {})).not.toContain(TOKEN)
    }

    const broken = fakeForge({ failWith: 500 })
    const error = await reportRun(failed('gate'), broken.forge).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain(TOKEN)
    expect((error as Error).message).toContain('500')
  })

  // Same ERESOLVE shape as scripts/npm-summary.test.ts: cordis 4.1.0 vs ~4.0.6-alpha.1, plus shell-env.
  const ERESOLVE_LOG = [
    'npm error code ERESOLVE',
    'npm error ERESOLVE could not resolve',
    'npm error',
    'npm error While resolving: @lllzt/dsh-webui-framework@0.4.0',
    'npm error Found: @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
    'npm error node_modules/@deepseek-ai/dsh-web-app',
    'npm error   dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
    'npm error',
    'npm error Could not resolve dependency:',
    'npm error peer @deepseek-ai/dsh-shell-env@"0.2.2-alpha.3" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
    'npm error node_modules/@deepseek-ai/dsh-web-app',
    'npm error   dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
    'npm error',
    'npm error Conflicting peer dependency: @deepseek-ai/dsh-shell-env@0.2.2-alpha.3',
    'npm error node_modules/@deepseek-ai/dsh-shell-env',
    'npm error   peer @deepseek-ai/dsh-shell-env@"0.2.2-alpha.3" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
    'npm error   node_modules/@deepseek-ai/dsh-web-app',
    'npm error     dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
    'npm error',
    'npm error Found: @deepseek-ai/cordis@4.1.0',
    'npm error node_modules/@deepseek-ai/cordis',
    'npm error   @deepseek-ai/cordis@"4.1.0" from the root project',
    'npm error',
    'npm error Could not resolve dependency:',
    'npm error peer @deepseek-ai/cordis@"~4.0.6-alpha.1" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
    'npm error node_modules/@deepseek-ai/dsh-web-app',
    'npm error   dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
    'npm error',
    'npm error Conflicting peer dependency: @deepseek-ai/cordis@4.0.6-alpha.1',
    'npm error node_modules/@deepseek-ai/cordis',
    'npm error   peer @deepseek-ai/cordis@"~4.0.6-alpha.1" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
    'npm error   node_modules/@deepseek-ai/dsh-web-app',
    'npm error     dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
    'npm error',
    'npm error Fix the upstream dependency conflict, or retry',
    'npm error this command with --force or --legacy-peer-deps',
    'npm error to accept an incorrect (and potentially broken) dependency resolution.',
    'npm error',
    'npm error /home/runner/.npm/_logs/2026-04-01T00_00_00_000Z-debug-0.log',
    'npm error https://registry.example.com/@deepseek-ai/cordis?token=ghp_0123456789abcdef0123456789abcdef01234567',
    'npm error cookie=sessionid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    `npm error token=${TOKEN}`,
  ].join('\n')

  const SUMMARY =
    'ERESOLVE: 3 conflicting package(s): @deepseek-ai/cordis@4.1.0, @deepseek-ai/dsh-shell-env@0.2.2-alpha.3, @deepseek-ai/dsh-web-app@0.2.2-alpha.2'

  const BULLETS = [
    '- @deepseek-ai/cordis: 4.1.0, ~4.0.6-alpha.1, 4.0.6-alpha.1',
    '- @deepseek-ai/dsh-shell-env: 0.2.2-alpha.3',
    '- @deepseek-ai/dsh-web-app: 0.2.2-alpha.2',
  ]

  it('A3 install failure issue includes the npm summary and conflict bullets, and a gate failure does not', async () => {
    const logged = (step: 'install' | 'gate') =>
      ({
        ok: false as const,
        version: VERSION,
        step,
        runUrl: RUN_URL,
        npmLog: ERESOLVE_LOG,
      }) satisfies DshRunOutcome

    const install = fakeForge()
    const created = await reportRun(logged('install'), install.forge)
    expect(created.action).toBe('issue-created')
    expect(install.writes()[0]?.body?.title).toBe(ISSUE_TITLE)
    const installBody = String(install.writes()[0]?.body?.body)
    expect(installBody).toContain(`失败的步骤：install`)
    expect(installBody).toContain(RUN_URL)
    expect(installBody).toContain(SUMMARY)
    expect(installBody.indexOf(SUMMARY)).toBeLessThan(installBody.indexOf(BULLETS[0] ?? ''))
    expect(installBody.match(/^- @\S+: .+$/gm)).toEqual(BULLETS)
    const again = await reportRun(logged('install'), install.forge)
    expect(again).toEqual({ action: 'issue-commented', number: created.number })
    expect(install.issues.filter((issue) => issue.title === ISSUE_TITLE)).toHaveLength(1)
    for (const request of install.requests) {
      const exposed = request.path + request.query.toString() + JSON.stringify(request.body ?? {})
      expect(exposed).not.toContain(TOKEN)
      expect(exposed).not.toContain('ghp_0123456789abcdef0123456789abcdef01234567')
      expect(exposed).not.toContain('cookie=')
      expect(exposed).not.toContain('?token=')
      expect(exposed).not.toContain('/home/')
    }

    const gate = fakeForge()
    await reportRun(logged('gate'), gate.forge)
    expect(gate.writes()[0]?.body?.title).toBe(ISSUE_TITLE)
    expect(String(gate.writes()[0]?.body?.body)).toContain(`失败的步骤：gate\n\n运行：${RUN_URL}\n`)
  })
})

describe('reportRun on success', () => {
  // Guard id is this exact title. It cannot also match the A<n> title prefix.
  // eslint-disable-next-line no-restricted-syntax
  it('A4:A4 opens a PR from the branch into main when no open PR has that branch', async () => {
    const fake = fakeForge({
      pulls: [
        { number: 5, state: 'open', head: { ref: 'dsh-alpha/0.2.2-alpha.9' } },
        { number: 6, state: 'closed', head: { ref: BRANCH } },
      ],
    })

    const result = await reportRun(passed, fake.forge)

    expect(result.action).toBe('pr-created')
    const writes = fake.writes()
    expect(writes).toHaveLength(1)
    expect(writes[0]?.method).toBe('POST')
    expect(writes[0]?.path).toBe(`${API}/pulls`)
    expect(writes[0]?.body).toMatchObject({ head: BRANCH, base: 'main', title: PR_TITLE })
    expect(String(writes[0]?.body?.body)).toContain(
      `dsh ${VERSION} 的门禁（npm run gate）与 host-compat 检查均已通过，依赖与 lockfile 已更新。`,
    )
    expect(String(writes[0]?.body?.body)).toContain('由 dsh-alpha 工作流自动生成。')
    expect(result.number).toBe(fake.pulls.find((pull) => pull.state === 'open' && pull.head.ref === BRANCH)?.number)
    const list = fake.requests.find((request) => request.method === 'GET' && request.path === `${API}/pulls`)
    expect(list?.query.get('state')).toBe('open')
  })

  it('A4 returns pr-exists with the existing number and creates nothing when the branch has an open PR', async () => {
    const fake = fakeForge({
      pulls: [
        { number: 5, state: 'open', head: { ref: 'dsh-alpha/0.2.2-alpha.9' } },
        { number: 9, state: 'open', head: { ref: BRANCH } },
      ],
    })

    const result = await reportRun(passed, fake.forge)

    expect(result).toEqual({ action: 'pr-exists', number: 9 })
    expect(fake.writes()).toEqual([])
  })

  it('A4 a failing API call throws without the token in the message', async () => {
    const fake = fakeForge({ failWith: 500 })

    const error = await reportRun(passed, fake.forge).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain(TOKEN)
    expect(fake.writes().every((request) => request.authorization?.includes(TOKEN) === true)).toBe(true)
  })
})

const REPORT = ['## 宿主差异', '', '- @deepseek-ai/cordis：无变化', ''].join('\n')

describe('reportRun report paragraph', () => {
  it('A3 the pass branch PR body and the fail branch issue body contain the report paragraph', async () => {
    const pass = fakeForge()
    await reportRun({ ...passed, report: REPORT }, pass.forge)
    const prBody = String(pass.writes()[0]?.body?.body)
    expect(prBody).toContain(
      `dsh ${VERSION} 的门禁（npm run gate）与 host-compat 检查均已通过，依赖与 lockfile 已更新。`,
    )
    expect(prBody).toContain('由 dsh-alpha 工作流自动生成。')
    expect(prBody).toContain(REPORT)
    expect(prBody.indexOf('由 dsh-alpha 工作流自动生成。')).toBeLessThan(prBody.indexOf('宿主差异'))

    const created = fakeForge()
    await reportRun({ ...failed('host-compat'), report: REPORT }, created.forge)
    const issueBody = String(created.writes()[0]?.body?.body)
    expect(issueBody).toContain('失败的步骤：host-compat')
    expect(issueBody).toContain(RUN_URL)
    expect(issueBody).toContain(REPORT)
    expect(issueBody.indexOf(RUN_URL)).toBeLessThan(issueBody.indexOf('宿主差异'))

    const commented = fakeForge({
      issues: [{ number: 7, title: ISSUE_TITLE, state: 'open' }],
    })
    await reportRun({ ...failed('gate'), report: REPORT }, commented.forge)
    expect(commented.writes()[0]?.path).toBe(`${API}/issues/7/comments`)
    const comment = String(commented.writes()[0]?.body?.body)
    expect(comment).toContain('失败的步骤：gate')
    expect(comment).toContain(REPORT)
    expect(comment.indexOf(RUN_URL)).toBeLessThan(comment.indexOf('宿主差异'))
  })

  it('A3 without a report the PR body and the issue body stay as before', async () => {
    const pass = fakeForge()
    await reportRun(passed, pass.forge)
    expect(String(pass.writes()[0]?.body?.body)).toBe(
      `dsh ${VERSION} 的门禁（npm run gate）与 host-compat 检查均已通过，依赖与 lockfile 已更新。\n\n由 dsh-alpha 工作流自动生成。\n`,
    )

    const fail = fakeForge()
    await reportRun(failed('gate'), fail.forge)
    expect(String(fail.writes()[0]?.body?.body)).toBe(`失败的步骤：gate\n\n运行：${RUN_URL}\n`)
  })
})

const smokeFailure = {
  ok: false as const,
  version: VERSION,
  step: 'smoke' as const,
  runUrl: RUN_URL,
}

describe('reportRun on a smoke failure', () => {
  it('A3 a smoke failure opens or updates an issue whose body names smoke', async () => {
    const created = fakeForge()
    const first = await reportRun(smokeFailure, created.forge)
    expect(first.action).toBe('issue-created')
    expect(created.writes()[0]?.body?.title).toBe(ISSUE_TITLE)
    const createdBody = String(created.writes()[0]?.body?.body)
    expect(createdBody).toContain('失败的步骤：smoke')
    expect(createdBody).toContain(RUN_URL)

    const existing = fakeForge({
      issues: [{ number: 7, title: ISSUE_TITLE, state: 'open' }],
    })
    const second = await reportRun(smokeFailure, existing.forge)
    expect(second).toEqual({ action: 'issue-commented', number: 7 })
    expect(existing.writes()[0]?.path).toBe(`${API}/issues/7/comments`)
    const comment = String(existing.writes()[0]?.body?.body)
    expect(comment).toContain('失败的步骤：smoke')
    expect(comment).toContain(RUN_URL)
  })
})

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

/** Forgejo stand-in on localhost. The CLI's fetch is not injectable, so nothing dials a real forge. */
const serveForge = async () => {
  const issues: { number: number; title: string; state: 'open' }[] = []
  const bodies: string[] = []
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw === '' ? undefined : (JSON.parse(raw) as { title?: string; body?: string })
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const json = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
        res.end(JSON.stringify(payload))
      }
      if (req.method === 'GET' && url.pathname === `${API}/issues`) {
        json(
          200,
          issues.filter((issue) => issue.state === 'open'),
        )
        return
      }
      if (req.method === 'POST' && url.pathname === `${API}/issues`) {
        const issue = { number: 11 + issues.length, title: String(body?.title), state: 'open' as const }
        issues.push(issue)
        bodies.push(String(body?.body))
        json(201, issue)
        return
      }
      if (req.method === 'POST' && /\/issues\/\d+\/comments$/.test(url.pathname)) {
        bodies.push(String(body?.body))
        json(201, { id: 1 })
        return
      }
      json(404, { message: 'not found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('forge stand-in has no port')
  const port = (address as AddressInfo).port
  const run = (args: string[]) =>
    new Promise<CliResult>((resolve) => {
      execFile(
        process.execPath,
        ['scripts/dsh-report.ts', ...args],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          env: {
            ...process.env,
            GITHUB_SERVER_URL: `http://127.0.0.1:${port}`,
            GITHUB_REPOSITORY: REPO,
            DSH_ALPHA_TOKEN: 'cli-token-smoke',
          },
          timeout: 10000,
        },
        (error, stdout, stderr) => {
          const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
          resolve({ code, stdout, stderr })
        },
      )
    })
  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections()
      server.close((error) => (error ? reject(error) : resolve()))
    })
  return { bodies, run, close }
}

describe('dsh-report CLI smoke step', () => {
  it('A3 the CLI accepts --fail smoke and the issue body names smoke', async () => {
    const forge = await serveForge()
    try {
      const created = await forge.run(['--fail', 'smoke', VERSION, RUN_URL])
      expect(created.code).toBe(0)
      expect(created.stdout).toContain('"action":"issue-created"')
      expect(created.stdout + created.stderr).not.toContain('cli-token-smoke')
      expect(forge.bodies[0]).toContain('失败的步骤：smoke')
      expect(forge.bodies[0]).toContain(RUN_URL)

      const commented = await forge.run(['--fail', 'smoke', VERSION, RUN_URL])
      expect(commented.code).toBe(0)
      expect(commented.stdout).toContain('"action":"issue-commented"')
      expect(forge.bodies[1]).toContain('失败的步骤：smoke')
      expect(forge.bodies[1]).toContain(RUN_URL)
    } finally {
      await forge.close()
    }
  })
})
