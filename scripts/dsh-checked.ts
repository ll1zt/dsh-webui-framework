import { isInvokedAsScript, messageOf } from './cli-utils.ts'
import { npmRegistry } from './dsh-bump.ts'
import type { Forge } from './dsh-report.ts'
import { alreadyChecked, planChecks } from './dsh-tags.ts'

/**
 * Decides which @deepseek-ai/dsh versions the daily check should run.
 *
 *   node scripts/dsh-checked.ts [--version <version>]
 *
 * Without `--version`, the alpha, next and latest dist-tags are read (the same `npm view` registry
 * as dsh-bump) and versions already mentioned as `dsh <version>` in an open or closed issue or pull
 * title are dropped. With `--version <version>`, that one version is printed unless it was already
 * checked. Prints one JSON line `{"versions":[…]}`.
 *
 * The forge comes from GITHUB_SERVER_URL and GITHUB_REPOSITORY; the token from DSH_ALPHA_TOKEN,
 * else GITHUB_TOKEN. The token only goes into the Authorization header; it is never printed and
 * never part of an error message.
 */

const DSH = '@deepseek-ai/dsh'
const PAGE_SIZE = 50
const MAX_PAGES = 20

const USAGE = 'usage: node scripts/dsh-checked.ts [--version <version>]'

export interface DistTagSource {
  distTags(pkg: string): Promise<Record<string, string>>
}

/** Title strings from issue and pull payloads. Non-arrays and entries without a string title are skipped. */
export function parseTitles(pages: readonly unknown[]): string[] {
  const titles: string[] = []
  for (const page of pages) {
    if (!Array.isArray(page)) continue
    for (const item of page) {
      if (typeof item !== 'object' || item === null || !('title' in item)) continue
      const title = item.title
      if (typeof title === 'string') titles.push(title)
    }
  }
  return titles
}

function redact(message: string, token: string): string {
  return token === '' ? message : message.split(token).join('[redacted]')
}

/** One Forgejo GET. A non-2xx answer throws with the status and path, never the token or the body. */
async function forgeGet(forge: Forge, pathWithQuery: string): Promise<unknown> {
  const path = pathWithQuery.split('?')[0] ?? pathWithQuery
  const url = `${forge.baseUrl.replace(/\/+$/, '')}/api/v1/repos/${forge.repo}${pathWithQuery}`
  const response = await forge.fetch(url, {
    headers: {
      Authorization: `token ${forge.token}`,
      Accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`Forgejo GET ${path} failed: HTTP ${response.status}`)
  return response.json()
}

async function listPages(forge: Forge, path: string, query: string): Promise<unknown[][]> {
  const pages: unknown[][] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await forgeGet(forge, `${path}?${query}&limit=${PAGE_SIZE}&page=${page}`)
    const items = Array.isArray(result) ? result : []
    pages.push(items)
    if (items.length < PAGE_SIZE) break
  }
  return pages
}

/** Open and closed issue titles, then open and closed pull titles. */
export async function listTitles(forge: Forge): Promise<string[]> {
  const issues = await listPages(forge, '/issues', 'state=all&type=issues')
  const pulls = await listPages(forge, '/pulls', 'state=all')
  return parseTitles([...issues, ...pulls])
}

/**
 * Versions still worth checking. An explicit `version` skips the dist-tag lookup and is returned
 * alone unless that version was already checked. Otherwise the alpha, next and latest tags of
 * `@deepseek-ai/dsh` are planned in that order, dropping versions the titles already mention.
 */
export async function versionsToCheck(
  input: { version?: string },
  registry: DistTagSource,
  titles: readonly string[],
): Promise<string[]> {
  const version = input.version
  if (version !== undefined && version !== '') return alreadyChecked(titles, version) ? [] : [version]
  const tags = await registry.distTags(DSH)
  return planChecks(tags, titles).map((target) => target.version)
}

function parseArgs(args: readonly string[]): { version?: string } | undefined {
  if (args.length === 0) return {}
  if (args[0] !== '--version' || args.length !== 2) return undefined
  const version = args[1]
  if (version === undefined || version === '' || version.startsWith('-')) return undefined
  return { version }
}

function requireEnv(env: NodeJS.ProcessEnv): { baseUrl: string; repo: string; token: string } | undefined {
  const baseUrl = env.GITHUB_SERVER_URL
  const repo = env.GITHUB_REPOSITORY
  const token = env.DSH_ALPHA_TOKEN || env.GITHUB_TOKEN
  if (!baseUrl || !repo || !token) return undefined
  return { baseUrl, repo, token }
}

async function runCli(args: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  const parsed = parseArgs(args)
  if (parsed === undefined) {
    console.error(USAGE)
    return 1
  }
  const forgeEnv = requireEnv(env)
  if (forgeEnv === undefined) {
    console.error(
      'dsh-checked: GITHUB_SERVER_URL, GITHUB_REPOSITORY and DSH_ALPHA_TOKEN (or GITHUB_TOKEN) are required',
    )
    return 1
  }
  try {
    const titles = await listTitles({ ...forgeEnv, fetch })
    const versions = await versionsToCheck(parsed, npmRegistry(), titles)
    console.log(JSON.stringify({ versions }))
    return 0
  } catch (error) {
    console.error(`dsh-checked: ${redact(messageOf(error), forgeEnv.token)}`)
    return 1
  }
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2), process.env)
}
