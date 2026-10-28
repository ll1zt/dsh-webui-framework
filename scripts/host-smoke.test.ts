import { describe, expect, it } from 'vitest'
import { checkHost } from './host-smoke.ts'
import type { HostSmokeReport, SmokeProblemCode } from './host-smoke.ts'

const HOST = 'http://host.test:8080/'
const TOKEN = 'TOKENVALUE123'
const COOKIE_VALUE = 'COOKIEVALUE456'
const COOKIE = `dsh-auth-abc=${COOKIE_VALUE}`
const PLUGIN_ID = '@lllzt/dsh-web-ui'
const PLUGIN_URL = 'plugins/??@lllzt/dsh-web-ui/client.js&rev=f909492e1212'
const BAD_REV_URL = 'plugins/??@lllzt/dsh-web-ui/client.js&rev=000000000000'
const LOADER_LINE = `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}", factory: (require) => {`
const BUNDLE_OK = `${LOADER_LINE}\n  return { apply() {} }\n} })\n`

/** Route keys are `pathname + search` of the requested URL, so the `??` bundle form stays intact. */
interface Reply {
  status: number
  body?: string
}
type Routes = Record<string, Reply>

const bootHtml = (entries: unknown[]): string => {
  const boot = { rev: '03bfb81d7dfb', release: { version: '0.2.1-rc.3', commit: '1f81c04' }, entries, batches: [] }
  return `<!doctype html>\n<html><head><base href="./"></head><body>\n<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(boot)}</script>\n</body></html>`
}

const PLUGIN_ENTRY = { id: PLUGIN_ID, url: PLUGIN_URL, rev: 'f909492e1212' }
const OTHER_ENTRY = {
  id: '@deepseek-ai/dsh-api-gateway',
  url: 'plugins/??@deepseek-ai/dsh-api-gateway/client.js&rev=730c776622ff',
  rev: '730c776622ff',
}

const GOOD_ROUTES: Routes = {
  '/': { status: 200, body: bootHtml([OTHER_ENTRY, PLUGIN_ENTRY]) },
  [`/${PLUGIN_URL}`]: { status: 200, body: BUNDLE_OK },
  [`/${BAD_REV_URL}`]: { status: 404 },
}

const withRoutes = (overrides: Routes): Routes => ({ ...GOOD_ROUTES, ...overrides })

interface FakeHostOptions {
  /** Requests without the session cookie get 401, as the real host does. */
  auth?: boolean
}

interface RecordedRequest {
  url: string
  cookie: string | null
}

/**
 * Stand-in for `fetch` backed by a route table. A `?token=` request gets the real host's 303 with
 * Set-Cookie and is never followed here. Every request is recorded with its `cookie` header.
 */
const fakeHost = (routes: Routes, options: FakeHostOptions = {}) => {
  const requests: RecordedRequest[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    const cookie = new Headers(init?.headers).get('cookie')
    requests.push({ url: url.href, cookie })
    if (url.searchParams.has('token')) {
      return new Response(null, {
        status: 303,
        headers: [
          ['location', './'],
          ['set-cookie', `${COOKIE}; Max-Age=60; Path=/; HttpOnly`],
        ],
      })
    }
    if (options.auth === true && cookie !== COOKIE) return new Response(null, { status: 401 })
    const reply = routes[url.pathname + url.search]
    if (reply === undefined) return new Response(null, { status: 404 })
    return new Response(reply.body ?? null, { status: reply.status, headers: { 'content-type': 'text/html' } })
  }
  return { fetchImpl: fetchImpl as typeof fetch, requests }
}

const runCheck = async (routes: Routes, options: FakeHostOptions = {}, baseUrl = HOST) => {
  const host = fakeHost(routes, options)
  const report: HostSmokeReport = await checkHost(baseUrl, host.fetchImpl)
  return { report, requests: host.requests }
}

const expectSingleProblem = (report: HostSmokeReport, code: SmokeProblemCode): void => {
  expect(report.problems).toHaveLength(1)
  expect(report.problems[0]).toMatch(new RegExp(`^${code}:`))
}

const at = (path: string): string => new URL(path, HOST).href

describe('checkHost', () => {
  it('A1 a healthy host yields no problems and a complete report', async () => {
    const { report, requests } = await runCheck(GOOD_ROUTES)

    expect(report.problems).toEqual([])
    expect(report.bootFound).toBe(true)
    expect(report.bundleUrl).toContain('rev=f909492e1212')
    expect(report.bundleStatus).toBe(200)
    expect(report.firstLineOk).toBe(true)
    expect(report.badRevStatus).toBe(404)
    expect(requests.some((request) => request.url.endsWith('rev=000000000000'))).toBe(true)
  })

  it('A2 missing plugin entry yields one plugin-missing problem', async () => {
    const { report } = await runCheck(withRoutes({ '/': { status: 200, body: bootHtml([OTHER_ENTRY]) } }))

    expectSingleProblem(report, 'plugin-missing')
  })

  it('A2 bundle answering 404 yields one bundle-status problem', async () => {
    const { report } = await runCheck(withRoutes({ [`/${PLUGIN_URL}`]: { status: 404 } }))

    expectSingleProblem(report, 'bundle-status')
  })

  it('A2 bundle whose first line is not the loader call yields one first-line problem', async () => {
    const stale = `/* stale build */\n${BUNDLE_OK}`
    const { report } = await runCheck(withRoutes({ [`/${PLUGIN_URL}`]: { status: 200, body: stale } }))

    expectSingleProblem(report, 'first-line')
  })

  it('A2 bad rev answering 200 yields one bad-rev-status problem', async () => {
    const { report } = await runCheck(withRoutes({ [`/${BAD_REV_URL}`]: { status: 200, body: BUNDLE_OK } }))

    expectSingleProblem(report, 'bad-rev-status')
  })

  it('A2 page without a boot injection yields one boot-missing problem', async () => {
    const { report } = await runCheck(
      withRoutes({ '/': { status: 200, body: '<!doctype html><html><body><p>boot</p></body></html>' } }),
    )

    expectSingleProblem(report, 'boot-missing')
  })

  it('A5 a tokenised baseUrl sends the session cookie on every follow-up request', async () => {
    const { report, requests } = await runCheck(GOOD_ROUTES, { auth: true }, `${HOST}?token=${TOKEN}`)
    const followUps = requests.slice(1)
    const urls = followUps.map((request) => request.url)

    expect(urls).toEqual(expect.arrayContaining([at('/'), at(`/${PLUGIN_URL}`), at(`/${BAD_REV_URL}`)]))
    expect(followUps.map((request) => request.cookie)).toEqual(followUps.map(() => COOKIE))
    expect(report.problems).toEqual([])
  })

  it('A5 a page answering 401 without a cookie yields one unauthorized problem', async () => {
    const { report } = await runCheck(GOOD_ROUTES, { auth: true })

    expect(report.problems.filter((problem: string) => problem.startsWith('unauthorized:'))).toHaveLength(1)
  })

  it('A5 the report carries neither the token value nor the cookie value', async () => {
    const { report } = await runCheck(
      withRoutes({ [`/${PLUGIN_URL}`]: { status: 404 } }),
      { auth: true },
      `${HOST}?token=${TOKEN}`,
    )
    const text = JSON.stringify(report)

    expect(report.problems.some((problem: string) => problem.startsWith('bundle-status:'))).toBe(true)
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain(COOKIE_VALUE)
  })
})
