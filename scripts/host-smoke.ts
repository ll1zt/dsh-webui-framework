import { isInvokedAsScript, messageOf } from './cli-utils.ts'
import { PLUGIN_ID } from './plugin-constants.ts'

/**
 * One real-host smoke: does a running dsh host carry this plugin in its boot
 * roster and serve its bundle? The host boots from a roster injected into the page, and a page
 * whose roster lacks the plugin boots without it, so the roster and the bundle are read directly.
 *
 * Two real-host facts shape the checks. Every request without a session cookie answers 401, and
 * the `?token=` URL printed at startup answers 303 with Set-Cookie, so the token is exchanged once
 * and the cookie rides on every later request. The `rev=` in the bundle URL is a cache key: the
 * host serves only the build it names, so a made-up rev must answer 404 and proves the check.
 *
 * Read-only (GET only). Output never carries the token, a cookie value or the full base URL.
 */

/** The first line of the served bundle: the loader call the build writes. */
const LOADER_PREFIX = `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}",`

/** The host injects the roster as `<script>globalThis["__DSH_BOOT__"] = {JSON}</script>`. */
const BOOT_MARKER = /globalThis\["__DSH_BOOT__"\]\s*=\s*/

const SCRIPT_END = '</script>'

/** A rev no build ever had; the host must refuse to serve it. */
const BAD_REV = '000000000000'

/** Enough for the host's own 303 hop to `./`; more hops means a redirect loop. */
const MAX_REDIRECTS = 5

/** The closed set of problem codes; every problem string starts with one of them, then `: `. */
export type SmokeProblemCode =
  'boot-missing' | 'plugin-missing' | 'bundle-status' | 'first-line' | 'bad-rev-status' | 'unauthorized'

export interface HostSmokeReport {
  bootFound: boolean
  bundleUrl: string | undefined
  bundleStatus: number | undefined
  firstLineOk: boolean
  badRevStatus: number | undefined
  problems: string[]
}

/** The state of one check: where it started, what it has learned about the session, and what it found. */
interface SmokeRun {
  readonly start: URL
  readonly fetchImpl: typeof fetch
  readonly cookies: Map<string, string>
  readonly secrets: string[]
  readonly problems: string[]
  unauthorized: boolean
}

/** The final status and body of one step, with the URL it finally answered from. */
interface Reply {
  status: number
  body: string
  url: URL
}

interface Hop {
  response: Response
  url: URL
}

type BootRead = { ok: true; entries: unknown[] } | { ok: false; reason: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The base URL and its `?token=` value; neither may reach output, nor any cookie value learned later. */
function secretsOf(baseUrl: string): string[] {
  const token = URL.canParse(baseUrl) ? new URL(baseUrl).searchParams.get('token') : null
  return token === null || token === '' ? [baseUrl] : [baseUrl, token]
}

function scrub(text: string, secrets: readonly string[]): string {
  return secrets.reduce((clean, secret) => (secret === '' ? clean : clean.split(secret).join('<redacted>')), text)
}

function problem(run: SmokeRun, code: SmokeProblemCode, detail: string): void {
  run.problems.push(`${code}: ${scrub(detail, run.secrets)}`)
}

/** A 401 has one root cause however many requests hit it, so it is reported once. */
function reportUnauthorized(run: SmokeRun, step: string): void {
  if (run.unauthorized) return
  run.unauthorized = true
  const hint =
    run.cookies.size === 0
      ? 'no session cookie was obtained; open the ?token= URL that dsh prints at startup'
      : 'the session cookie was rejected'
  problem(run, 'unauthorized', `${step} answered 401: ${hint}`)
}

function createRun(baseUrl: string, fetchImpl: typeof fetch): SmokeRun {
  let start: URL
  try {
    start = new URL(baseUrl)
  } catch {
    throw new TypeError('baseUrl is not an absolute URL')
  }
  return { start, fetchImpl, cookies: new Map(), secrets: secretsOf(baseUrl), problems: [], unauthorized: false }
}

/** The session cookie belongs to the start origin; a redirect or roster url elsewhere must not receive it. */
const isStartOrigin = (run: SmokeRun, url: URL): boolean => url.origin === run.start.origin

function requestHeaders(run: SmokeRun, url: URL): Record<string, string> {
  if (run.cookies.size === 0 || !isStartOrigin(run, url)) return {}
  return { cookie: [...run.cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
}

/** Keeps only `name=value` from each Set-Cookie line; attributes such as HttpOnly are not secrets. */
function rememberCookies(run: SmokeRun, response: Response, url: URL): void {
  if (!isStartOrigin(run, url)) return
  for (const line of response.headers.getSetCookie()) {
    const pair = (line.split(';')[0] ?? '').trim()
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    const value = pair.slice(eq + 1)
    run.cookies.set(pair.slice(0, eq), value)
    run.secrets.push(value)
  }
}

/** GET with manual redirects, so the cookie from the host's 303 is kept and sent on every later same-origin hop. */
async function get(run: SmokeRun, url: URL): Promise<Hop> {
  let target = url
  for (let hop = 0; ; hop += 1) {
    const response = await run.fetchImpl(target.href, { redirect: 'manual', headers: requestHeaders(run, target) })
    const isRedirect = response.status >= 300 && response.status <= 399
    if (!isRedirect) return { response, url: target }
    rememberCookies(run, response, target)
    const location = response.headers.get('location')
    if (location === null || hop === MAX_REDIRECTS) return { response, url: target }
    await discard(response)
    target = new URL(location, target)
  }
}

async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

/** Runs one request step; a network failure becomes a problem with the step's code, never an escaped error. */
async function attempt<T>(
  run: SmokeRun,
  code: SmokeProblemCode,
  step: string,
  url: URL,
  action: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await action()
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    problem(run, code, `${step} request failed (${name}: ${scrub(messageOf(error), [url.href])})`)
    return undefined
  }
}

async function fetchReply(
  run: SmokeRun,
  code: SmokeProblemCode,
  step: string,
  url: URL,
  readBody: boolean,
): Promise<Reply | undefined> {
  return attempt(run, code, step, url, async () => {
    const { response, url: finalUrl } = await get(run, url)
    if (!readBody || response.status !== 200) {
      await discard(response)
      return { status: response.status, body: '', url: finalUrl }
    }
    return { status: response.status, body: await response.text(), url: finalUrl }
  })
}

/** The roster the host injected into the page, or the reason it could not be read. */
function readBoot(html: string): BootRead {
  const marker = BOOT_MARKER.exec(html)
  if (marker === null) return { ok: false, reason: 'no __DSH_BOOT__ injection in the page' }
  const rest = html.slice(marker.index + marker[0].length)
  const end = rest.indexOf(SCRIPT_END)
  if (end === -1) return { ok: false, reason: '__DSH_BOOT__ injection is not closed by </script>' }
  let parsed: unknown
  try {
    parsed = JSON.parse(rest.slice(0, end))
  } catch {
    return { ok: false, reason: '__DSH_BOOT__ injection is not valid JSON' }
  }
  const entries = isRecord(parsed) ? parsed.entries : undefined
  if (!Array.isArray(entries)) return { ok: false, reason: '__DSH_BOOT__ has no entries array' }
  return { ok: true, entries }
}

function findPluginUrl(entries: readonly unknown[]): string | undefined {
  for (const entry of entries) {
    if (isRecord(entry) && entry.id === PLUGIN_ID && typeof entry.url === 'string') return entry.url
  }
  return undefined
}

/** Roster urls are relative to the page; the page URL is the one the redirects finally landed on. */
function resolveUrl(path: string, base: URL): URL | undefined {
  try {
    return new URL(path, base)
  } catch {
    return undefined
  }
}

/** The same bundle URL with its rev replaced by one the host never built. */
function withBadRev(bundle: URL): URL | undefined {
  if (!/[?&]rev=/.test(bundle.href)) return undefined
  return new URL(bundle.href.replace(/([?&]rev=)[^&#]*/, `$1${BAD_REV}`))
}

/** The first line of the body; a body that is empty or has no newline is its own first line. */
const firstLine = (body: string): string => body.split('\n', 1)[0] ?? ''

/**
 * Check that a running dsh host has loaded this plugin and serves its bundle.
 * @param baseUrl - the host URL; may carry the `?token=` printed at startup.
 * @param fetchImpl - the fetch to use; injectable for tests.
 * @returns the findings; `problems` is empty when every check passes.
 */
export async function checkHost(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<HostSmokeReport> {
  const run = createRun(baseUrl, fetchImpl)
  const report: HostSmokeReport = {
    bootFound: false,
    bundleUrl: undefined,
    bundleStatus: undefined,
    firstLineOk: false,
    badRevStatus: undefined,
    problems: run.problems,
  }

  const page = await fetchReply(run, 'boot-missing', 'page', run.start, true)
  if (page === undefined) return report
  if (page.status === 401) {
    reportUnauthorized(run, 'page')
    return report
  }
  if (page.status !== 200) {
    problem(run, 'boot-missing', `page answered ${page.status}, expected 200 with the boot injection`)
    return report
  }

  const boot = readBoot(page.body)
  if (!boot.ok) {
    problem(run, 'boot-missing', boot.reason)
    return report
  }
  report.bootFound = true

  const pluginPath = findPluginUrl(boot.entries)
  const bundle = pluginPath === undefined ? undefined : resolveUrl(pluginPath, page.url)
  if (bundle === undefined) {
    problem(run, 'plugin-missing', `roster has no ${PLUGIN_ID} entry with a usable url`)
    return report
  }
  report.bundleUrl = bundle.href

  const served = await fetchReply(run, 'bundle-status', 'bundle', bundle, true)
  if (served !== undefined) {
    report.bundleStatus = served.status
    if (served.status === 401) {
      reportUnauthorized(run, 'bundle')
    } else if (served.status !== 200) {
      problem(run, 'bundle-status', `bundle answered ${served.status}, expected 200`)
    } else {
      report.firstLineOk = firstLine(served.body).startsWith(LOADER_PREFIX)
      if (!report.firstLineOk) problem(run, 'first-line', `bundle first line is not the ${PLUGIN_ID} loader call`)
    }
  }

  const badRev = withBadRev(bundle)
  if (badRev === undefined) {
    problem(run, 'bad-rev-status', 'bundle url has no rev= parameter to probe')
    return report
  }
  const probe = await fetchReply(run, 'bad-rev-status', 'bad-rev', badRev, false)
  if (probe !== undefined) {
    report.badRevStatus = probe.status
    if (probe.status === 401) {
      reportUnauthorized(run, 'bad-rev probe')
    } else if (probe.status !== 404) {
      problem(run, 'bad-rev-status', `bundle with a made-up rev answered ${probe.status}, expected 404`)
    }
  }
  return report
}

/** Human-readable lines; the bundle is shown by path and query only, never by origin or token. */
function summarize(report: HostSmokeReport): string[] {
  const bundle = report.bundleUrl === undefined ? 'not resolved' : pathOf(report.bundleUrl)
  const lines = [
    'host-smoke:',
    `  boot injection: ${report.bootFound ? 'found' : 'not found'}`,
    `  bundle: ${bundle}`,
    `  bundle status: ${report.bundleStatus ?? 'no response'}`,
    `  first line: ${report.firstLineOk ? 'ok' : 'mismatch'}`,
    `  bad rev status: ${report.badRevStatus ?? 'no response'}`,
  ]
  if (report.problems.length === 0) {
    lines.push('  problems: none')
  } else {
    lines.push(`  problems: ${report.problems.length}`)
    for (const text of report.problems) lines.push(`    ${text}`)
  }
  return lines
}

function pathOf(url: string): string {
  const parsed = new URL(url)
  return parsed.pathname + parsed.search
}

async function runCli(baseUrl: string): Promise<number> {
  const secrets = secretsOf(baseUrl)
  let report: HostSmokeReport
  try {
    report = await checkHost(baseUrl)
  } catch (error) {
    console.error(`host-smoke: ${scrub(messageOf(error), secrets)}`)
    return 2
  }
  for (const line of summarize(report)) console.log(scrub(line, secrets))
  return report.problems.length === 0 ? 0 : 1
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  const baseUrl = process.argv[2]
  if (baseUrl === undefined) {
    console.error('usage: npm run -s smoke -- <baseUrl>')
    process.exitCode = 2
  } else {
    process.exitCode = await runCli(baseUrl)
  }
}
