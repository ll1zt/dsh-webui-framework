import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TOKEN = 'CLITOKEN{{SECRET_q9x2m4}}'
const COOKIE_VALUE = 'CLICOOKIEVALUE789'
const COOKIE = `dsh-auth-cli=${COOKIE_VALUE}`
const PLUGIN_ID = '@lllzt/dsh-web-ui'
const PLUGIN_URL = 'plugins/??@lllzt/dsh-web-ui/client.js&rev=f909492e1212'
const BUNDLE = `window.__ModuleLoader__.load({ id: "${PLUGIN_ID}", factory: (require) => {\n  return { apply() {} }\n} })\n`
const boot = { rev: '03bfb81d7dfb', entries: [{ id: PLUGIN_ID, url: PLUGIN_URL, rev: 'f909492e1212' }], batches: [] }
const PAGE = `<!doctype html>\n<html><body>\n<script>globalThis["__DSH_BOOT__"] = ${JSON.stringify(boot)}</script>\n</body></html>`

/** A local stand-in for the dsh host: 401 without the cookie, 303 + Set-Cookie for `?token=`. */
const fakeHost = (): Server =>
  createServer((req, res) => {
    const url = req.url ?? ''
    if (url.includes('?token=')) {
      res.writeHead(303, { location: './', 'set-cookie': `${COOKIE}; Max-Age=60; Path=/; HttpOnly` }).end()
    } else if (!(req.headers.cookie ?? '').includes(COOKIE)) {
      res.writeHead(401).end()
    } else if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
    } else if (url === `/${PLUGIN_URL}`) {
      res.writeHead(200, { 'content-type': 'text/javascript' }).end(BUNDLE)
    } else {
      res.writeHead(404).end()
    }
  })

interface CliResult {
  code: number | null
  stdout: string
  stderr: string
}

const runCli = (args: string[]): Promise<CliResult> =>
  new Promise((resolve) => {
    execFile(process.execPath, ['scripts/host-smoke.ts', ...args], { cwd: ROOT }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : null
      resolve({ code, stdout, stderr })
    })
  })

describe('host-smoke CLI', () => {
  const server = fakeHost()
  let origin = ''

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('A3 running without a baseUrl exits 2 with the silent-npm usage on stderr', async () => {
    const { code, stderr } = await runCli([])

    expect(code).toBe(2)
    expect(stderr).toContain('npm run -s smoke --')
  })

  it('A4 a healthy host exits 0 and neither stream carries the token or the cookie value', async () => {
    const { code, stdout, stderr } = await runCli([`${origin}?token=${TOKEN}`])

    expect(code).toBe(0)
    expect(stdout).toContain('problems: none')
    for (const text of [stdout, stderr]) {
      expect(text).not.toContain(TOKEN)
      expect(text).not.toContain(COOKIE_VALUE)
    }
  })

  it('A5 a host that needs auth exits 1 with unauthorized and never prints the full URL', async () => {
    const { code, stdout, stderr } = await runCli([origin])

    expect(code).toBe(1)
    expect(stdout).toContain('unauthorized:')
    expect(stdout + stderr).not.toContain(origin)
  })
})
