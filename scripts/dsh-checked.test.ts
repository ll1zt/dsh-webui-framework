import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { listTitles, parseTitles, versionsToCheck } from './dsh-checked.ts'

const SCRIPT = fileURLToPath(new URL('dsh-checked.ts', import.meta.url))
const TOKEN = 'dsh-token-9f3c1a7e'
const BASE = 'https://forge.test:3000'
const REPO = 'lllzt/dsh-webui-framework'
const API = `/api/v1/repos/${REPO}`
const DSH = '@deepseek-ai/dsh'

interface Listed {
  title: string
  state: 'open' | 'closed'
}

interface Recorded {
  path: string
  query: string
  authorization: string | null
}

/** Forgejo stand-in. Closed rows are visible only for `state=all` or `state=closed`; nothing is dialed. */
const fakeForge = (state: { issues?: Listed[]; pulls?: Listed[]; failWith?: number } = {}) => {
  const issues = state.issues ?? []
  const pulls = state.pulls ?? []
  const requests: Recorded[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    const authorization = new Headers(init?.headers).get('authorization')
    requests.push({ path: url.pathname, query: url.searchParams.toString(), authorization })
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    if (state.failWith !== undefined) return json(state.failWith, { message: TOKEN })
    const wanted = url.pathname === `${API}/pulls` ? pulls : url.pathname === `${API}/issues` ? issues : undefined
    if (wanted === undefined) return json(404, { message: 'not found' })
    const which = url.searchParams.get('state')
    const visible =
      which === 'all'
        ? wanted
        : which === 'closed'
          ? wanted.filter((item) => item.state === 'closed')
          : wanted.filter((item) => item.state === 'open')
    const page = Number(url.searchParams.get('page') ?? '1')
    const limitRaw = url.searchParams.get('limit')
    const limit = limitRaw === null ? visible.length : Number(limitRaw)
    const start = (page - 1) * limit
    return json(200, visible.slice(start, start + limit))
  }
  return {
    forge: { baseUrl: BASE, repo: REPO, token: TOKEN, fetch: fetchImpl },
    requests,
  }
}

describe('parseTitles', () => {
  it('A2 collects title strings from issue and pull payloads', () => {
    expect(
      parseTitles([
        [
          { title: 'dsh 0.2.2-rc.1：兼容性检查失败' },
          { title: '升级到 dsh 0.2.2-rc.1' },
          { body: 'no title' },
          { title: 3 },
          null,
        ],
        [{ title: 'closed one' }],
      ]),
    ).toEqual(['dsh 0.2.2-rc.1：兼容性检查失败', '升级到 dsh 0.2.2-rc.1', 'closed one'])
    expect(parseTitles([])).toEqual([])
    expect(parseTitles([[]])).toEqual([])
  })
})

describe('listTitles', () => {
  const issues: Listed[] = [
    { title: 'open issue', state: 'open' },
    { title: 'closed issue', state: 'closed' },
  ]
  const pulls: Listed[] = [
    { title: 'open pr', state: 'open' },
    { title: 'closed pr', state: 'closed' },
  ]

  it('A2 includes open and closed issue and pull titles', async () => {
    const fake = fakeForge({ issues, pulls })

    const titles = await listTitles(fake.forge)

    expect([...titles].sort()).toEqual(['closed issue', 'closed pr', 'open issue', 'open pr'])
    expect(new Set(fake.requests.map((request) => request.path))).toEqual(new Set([`${API}/issues`, `${API}/pulls`]))
    for (const request of fake.requests) {
      expect(request.authorization).toContain(TOKEN)
      expect(request.path + request.query).not.toContain(TOKEN)
    }
  })

  it('A2 a failed title listing does not reveal the token', async () => {
    const fake = fakeForge({ failWith: 500 })

    const error = await listTitles(fake.forge).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('500')
    expect((error as Error).message).not.toContain(TOKEN)
    expect(fake.requests.every((request) => request.authorization?.includes(TOKEN) === true)).toBe(true)
    expect(fake.requests.every((request) => (request.path + request.query).includes(TOKEN) === false)).toBe(true)
  })
})

describe('versionsToCheck', () => {
  it('A2 reads dsh dist-tags and drops a version already checked', async () => {
    const calls: string[] = []
    const registry = {
      async distTags(pkg: string) {
        calls.push(pkg)
        return { latest: '0.2.2', alpha: '0.2.2-alpha.2', next: '0.2.2-rc.1' }
      },
    }

    const versions = await versionsToCheck({}, registry, ['dsh 0.2.2-rc.1：兼容性检查失败'])

    expect(calls).toEqual([DSH])
    expect(versions).toEqual(['0.2.2-alpha.2', '0.2.2'])
  })

  it('A3 an explicit version bypasses dist-tags unless that version was already checked', async () => {
    const calls: string[] = []
    const registry = {
      async distTags(pkg: string) {
        calls.push(pkg)
        throw new Error('dist-tags should not be read')
      },
    }

    await expect(versionsToCheck({ version: '0.2.2-rc.1' }, registry, [])).resolves.toEqual(['0.2.2-rc.1'])
    await expect(versionsToCheck({ version: '0.2.2-rc.1' }, registry, ['升级到 dsh 0.2.2-rc.1'])).resolves.toEqual([])
    expect(calls).toEqual([])
  })
})

describe('dsh-checked CLI', () => {
  it('A3 --version without a value exits 1', async () => {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
      execFile(process.execPath, [SCRIPT, '--version'], { timeout: 15000 }, (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
        resolve({ code, stdout, stderr })
      })
    })

    expect(result.code).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('--version')
  })
})
