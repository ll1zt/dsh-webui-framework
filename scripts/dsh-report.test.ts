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
  it('A3 opens an issue with the failed step and the run link when none with that title is open', async () => {
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
})

describe('reportRun on success', () => {
  it('A4 opens a PR from the branch into main when no open PR has that branch', async () => {
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
