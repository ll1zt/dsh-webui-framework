import { readFileSync } from 'node:fs'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'
import { summarizeNpmError } from './npm-summary.ts'

/**
 * Reports the result of a dsh-alpha run to Forgejo: a failure opens (or comments on) the issue
 * for that dsh version, a pass opens the upgrade PR from the branch the workflow pushed.
 *
 *   node scripts/dsh-report.ts --pass <version>
 *   node scripts/dsh-report.ts --fail <install|gate|host-compat> <version> <run-url> [--npm-log <path>]
 *
 * `--npm-log` is the install step's npm output. On an install failure its conflict summary is
 * appended to the issue; the raw log (and anything token-like in it) is not. The forge comes from
 * GITHUB_SERVER_URL and GITHUB_REPOSITORY; the token from DSH_ALPHA_TOKEN, else GITHUB_TOKEN.
 * The token only goes into the Authorization header; it is never printed and never part of an
 * error message. Prints one JSON line `{"action":…,"number":…}`.
 */

export type DshRunOutcome =
  | { ok: true; version: string; branch: string }
  | {
      ok: false
      version: string
      step: 'install' | 'gate' | 'host-compat'
      runUrl: string
      npmLog?: string
    }

export interface Forge {
  baseUrl: string
  repo: string
  token: string
  fetch: typeof fetch
}

const STEPS = ['install', 'gate', 'host-compat'] as const
const PAGE_SIZE = 50
const MAX_PAGES = 20

/** One Forgejo API call; a non-2xx answer throws with the status and endpoint but never the token. */
async function call(forge: Forge, method: string, path: string, body?: unknown): Promise<unknown> {
  const url = `${forge.baseUrl.replace(/\/+$/, '')}/api/v1/repos/${forge.repo}${path}`
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `token ${forge.token}`,
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }
  const response = await forge.fetch(url, init)
  if (!response.ok) {
    const endpoint = path.split('?')[0]
    throw new Error(`Forgejo ${method} ${endpoint} failed: HTTP ${response.status}`)
  }
  return response.json()
}

/** Every entry of an open-state list endpoint, page by page. */
async function listOpen(forge: Forge, path: string, extra: string): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await call(forge, 'GET', `${path}?state=open${extra}&limit=${PAGE_SIZE}&page=${page}`)
    const items = Array.isArray(result) ? (result as Record<string, unknown>[]) : []
    all.push(...items)
    if (items.length < PAGE_SIZE) break
  }
  return all
}

/** Issue body: the failed step and run link, plus the npm conflict summary when install captured a log. */
function failureText(outcome: Extract<DshRunOutcome, { ok: false }>): string {
  const lines = [`失败的步骤：${outcome.step}`, '', `运行：${outcome.runUrl}`]
  if (outcome.step === 'install' && outcome.npmLog !== undefined) {
    const { summary, conflicts } = summarizeNpmError(outcome.npmLog)
    lines.push('', summary)
    for (const conflict of conflicts) lines.push(`- ${conflict.package}: ${conflict.versions.join(', ')}`)
  }
  return `${lines.join('\n')}\n`
}

async function reportFailure(
  outcome: Extract<DshRunOutcome, { ok: false }>,
  forge: Forge,
): Promise<{ action: 'issue-created' | 'issue-commented'; number: number }> {
  const title = `dsh ${outcome.version}：兼容性检查失败`
  const text = failureText(outcome)
  const open = await listOpen(forge, '/issues', '&type=issues')
  const existing = open.find((issue) => issue.title === title)
  if (existing !== undefined) {
    const number = Number(existing.number)
    await call(forge, 'POST', `/issues/${number}/comments`, { body: text })
    return { action: 'issue-commented', number }
  }
  const created = (await call(forge, 'POST', '/issues', { title, body: text })) as { number: number }
  return { action: 'issue-created', number: created.number }
}

async function reportPass(
  outcome: Extract<DshRunOutcome, { ok: true }>,
  forge: Forge,
): Promise<{ action: 'pr-created' | 'pr-exists'; number: number }> {
  const open = await listOpen(forge, '/pulls', '')
  const existing = open.find((pull) => (pull.head as { ref?: unknown } | undefined)?.ref === outcome.branch)
  if (existing !== undefined) return { action: 'pr-exists', number: Number(existing.number) }
  const created = (await call(forge, 'POST', '/pulls', {
    head: outcome.branch,
    base: 'main',
    title: `升级到 dsh ${outcome.version}`,
    body: `dsh ${outcome.version} 的门禁（npm run gate）与 host-compat 检查均已通过，依赖与 lockfile 已更新。\n\n由 dsh-alpha 工作流自动生成。\n`,
  })) as { number: number }
  return { action: 'pr-created', number: created.number }
}

export async function reportRun(
  outcome: DshRunOutcome,
  forge: Forge,
): Promise<{ action: 'issue-created' | 'issue-commented' | 'pr-created' | 'pr-exists'; number: number }> {
  return outcome.ok ? reportPass(outcome, forge) : reportFailure(outcome, forge)
}

const USAGE =
  'usage: node scripts/dsh-report.ts --pass <version> | --fail <install|gate|host-compat> <version> <run-url> [--npm-log <path>]'

interface Parsed {
  outcome: DshRunOutcome
  npmLogPath?: string
}

/** Pulls an optional `--npm-log <path>` out of the argv, leaving the original --pass / --fail form. */
function splitNpmLog(args: string[]): { rest: string[]; npmLogPath?: string } | null {
  const rest: string[] = []
  let npmLogPath: string | undefined
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg !== '--npm-log') {
      if (arg !== undefined) rest.push(arg)
      continue
    }
    const path = args[index + 1]
    if (path === undefined || path === '' || path.startsWith('--') || npmLogPath !== undefined) return null
    npmLogPath = path
    index += 1
  }
  return { rest, ...(npmLogPath === undefined ? {} : { npmLogPath }) }
}

function parseArgs(args: string[]): Parsed | null {
  const split = splitNpmLog(args)
  if (split === null) return null
  const { rest, npmLogPath } = split
  const [mode, first, second, third] = rest
  if (mode === '--pass' && first !== undefined && first !== '' && rest.length === 2 && npmLogPath === undefined) {
    return { outcome: { ok: true, version: first, branch: `dsh-alpha/${first}` } }
  }
  const step = STEPS.find((candidate) => candidate === first)
  if (mode === '--fail' && step !== undefined && second && third && rest.length === 4) {
    return {
      outcome: { ok: false, version: second, step, runUrl: third },
      ...(npmLogPath === undefined ? {} : { npmLogPath }),
    }
  }
  return null
}

function withNpmLog(parsed: Parsed): DshRunOutcome {
  if (parsed.npmLogPath === undefined || parsed.outcome.ok) return parsed.outcome
  return { ...parsed.outcome, npmLog: readFileSync(parsed.npmLogPath, 'utf8') }
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const parsed = parseArgs(args)
  if (parsed === null) {
    console.error(USAGE)
    return 2
  }
  const baseUrl = env.GITHUB_SERVER_URL
  const repo = env.GITHUB_REPOSITORY
  const token = env.DSH_ALPHA_TOKEN || env.GITHUB_TOKEN
  if (!baseUrl || !repo || !token) {
    console.error('dsh-report: GITHUB_SERVER_URL, GITHUB_REPOSITORY and DSH_ALPHA_TOKEN (or GITHUB_TOKEN) are required')
    return 2
  }
  try {
    console.log(JSON.stringify(await reportRun(withNpmLog(parsed), { baseUrl, repo, token, fetch })))
    return 0
  } catch (error) {
    console.error(`dsh-report: ${messageOf(error)}`)
    return 1
  }
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), process.env)
}
