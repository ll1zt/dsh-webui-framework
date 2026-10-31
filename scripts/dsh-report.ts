import { isInvokedAsScript, messageOf } from './cli-utils.ts'

/**
 * Reports the result of a dsh-alpha run to Forgejo: a failure opens (or comments on) the issue
 * for that dsh version, a pass opens the upgrade PR from the branch the workflow pushed.
 *
 *   node scripts/dsh-report.ts --pass <version>
 *   node scripts/dsh-report.ts --fail <install|gate|host-compat> <version> <run-url>
 *
 * The forge comes from GITHUB_SERVER_URL and GITHUB_REPOSITORY; the token from DSH_ALPHA_TOKEN,
 * else GITHUB_TOKEN. The token only goes into the Authorization header; it is never printed and
 * never part of an error message. Prints one JSON line `{"action":…,"number":…}`.
 */

export type DshRunOutcome =
  | { ok: true; version: string; branch: string }
  | { ok: false; version: string; step: 'install' | 'gate' | 'host-compat'; runUrl: string }

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

async function reportFailure(
  outcome: Extract<DshRunOutcome, { ok: false }>,
  forge: Forge,
): Promise<{ action: 'issue-created' | 'issue-commented'; number: number }> {
  const title = `dsh ${outcome.version}：兼容性检查失败`
  const text = `失败的步骤：${outcome.step}\n\n运行：${outcome.runUrl}\n`
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
  'usage: node scripts/dsh-report.ts --pass <version> | --fail <install|gate|host-compat> <version> <run-url>'

function parseOutcome(args: string[]): DshRunOutcome | null {
  const [mode, first, second, third] = args
  if (mode === '--pass' && first !== undefined && first !== '' && args.length === 2) {
    return { ok: true, version: first, branch: `dsh-alpha/${first}` }
  }
  const step = STEPS.find((candidate) => candidate === first)
  if (mode === '--fail' && step !== undefined && second && third && args.length === 4) {
    return { ok: false, version: second, step, runUrl: third }
  }
  return null
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const outcome = parseOutcome(args)
  if (outcome === null) {
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
    console.log(JSON.stringify(await reportRun(outcome, { baseUrl, repo, token, fetch })))
    return 0
  } catch (error) {
    console.error(`dsh-report: ${messageOf(error)}`)
    return 1
  }
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), process.env)
}
