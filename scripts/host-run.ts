import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isInvokedAsScript, messageOf } from './cli-utils.ts'

/**
 * Starts a real dsh host for the CI smoke, against a throwaway home.
 *
 * A fresh profile only lists `@deepseek-ai/dsh-base`, so `plugin add` never puts the web app on
 * the boot roster and the host never prints a `?token=` URL. The working order (rc.1) is:
 *
 *   1. `dsh --profile <p> --from-default-profile web --dump-config` (seed the web template, exit 0)
 *   2. `dsh plugin --profile <p> add <tarball>` (append this package to that roster)
 *   3. `dsh --profile <p> --no-open --host 127.0.0.1 --port <port>` (stay up, print the URL)
 *
 * Each child gets `DSH_HOME` and `HOME` set to `dshHome`; the parent environment is left alone.
 * The first `http://…?token=…` line on stdout or stderr is the base URL. A phase that does not
 * finish within `timeoutMs` (default 120s) is killed and rejected with an Error whose message
 * contains `timeout` and never the token or the child output.
 *
 *   node scripts/host-run.ts --dsh <bin> --home <dir> --profile <name> --tarball <path> --port <port>
 *
 * The CLI prints one JSON line `{"baseUrl":"…"}` with the token redacted, writes the real URL to
 * `<home>/host-base-url` (mode 0600) for the smoke client, and stays up until SIGINT or SIGTERM.
 */

const DEFAULT_TIMEOUT_MS = 120_000
const STOP_GRACE_MS = 1_000
const STOP_FALLBACK_MS = 3_000
const HOST_BASE_URL_FILE = 'host-base-url'

/** A full URL ending at whitespace, so a chunk that ends mid-token is not treated as complete. */
const URL_RE = /(https?:\/\/[^\s]*\?token=[^\s]+)(?=\s)/

export interface HostRunOptions {
  dsh: string
  dshHome: string
  profile: string
  tarball: string
  port: number
  timeoutMs?: number
}

export interface RunningHost {
  baseUrl: string
  stop(): Promise<void>
}

const USAGE =
  'usage: node scripts/host-run.ts --dsh <bin> --home <dsh-home> --profile <name> --tarball <path> --port <port>'

function childEnv(dshHome: string): NodeJS.ProcessEnv {
  return { ...process.env, HOME: dshHome, DSH_HOME: dshHome }
}

/** Best-effort reap if this process is exiting while a child is still alive. Synchronous: `exit` cannot wait. */
function tieToProcessExit(child: ChildProcess): void {
  const killOnExit = () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }
  process.on('exit', killOnExit)
  child.once('exit', () => process.off('exit', killOnExit))
}

/** SIGTERM, a short grace, then SIGKILL. Resolves once the child has exited (or the fallback elapses). */
function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const timers: { grace?: ReturnType<typeof setTimeout>; fallback?: ReturnType<typeof setTimeout> } = {}
    const finish = () => {
      if (done) return
      done = true
      if (timers.grace !== undefined) clearTimeout(timers.grace)
      if (timers.fallback !== undefined) clearTimeout(timers.fallback)
      resolve()
    }
    child.once('exit', finish)
    if (child.exitCode !== null || child.signalCode !== null) {
      finish()
      return
    }
    timers.grace = setTimeout(() => {
      if (done || child.exitCode !== null || child.signalCode !== null) return
      try {
        child.kill('SIGKILL')
      } catch {
        finish()
      }
    }, STOP_GRACE_MS)
    timers.fallback = setTimeout(finish, STOP_FALLBACK_MS)
    try {
      child.kill('SIGTERM')
    } catch {
      finish()
    }
  })
}

/**
 * Runs one short-lived dsh command to completion. Non-zero exits reject with the exit status.
 * A timeout rejects with `timeout` and does not include the child's output.
 */
function runToExit(
  dsh: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(dsh, [...args], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    tieToProcessExit(child)
    let stderr = ''
    let settled = false
    let timedOut = false
    const clock: { timer?: ReturnType<typeof setTimeout> } = {}
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (clock.timer !== undefined) clearTimeout(clock.timer)
      if (error === undefined) resolve()
      else reject(error)
    }
    child.stdout?.on('data', () => {})
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length >= 4_000) return
      stderr += chunk
      if (stderr.length > 4_000) stderr = stderr.slice(0, 4_000)
    })
    child.once('error', (error) => finish(error))
    child.once('exit', (code, signal) => {
      if (timedOut) return
      if (code === 0) {
        finish()
        return
      }
      const how = code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`
      const detail = stderr.trim()
      finish(new Error(detail === '' ? `dsh ${label} failed (${how})` : `dsh ${label} failed (${how}): ${detail}`))
    })
    clock.timer = setTimeout(() => {
      timedOut = true
      void killChild(child).then(() => finish(new Error(`timeout waiting for dsh ${label}`)))
    }, timeoutMs)
  })
}

/** Resolves with the first token URL. On timeout the child is killed and the rejection text has no token. */
function waitForUrl(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false
    let timedOut = false
    const clock: { timer?: ReturnType<typeof setTimeout> } = {}
    const succeed = (url: string) => {
      if (settled || timedOut) return
      settled = true
      if (clock.timer !== undefined) clearTimeout(clock.timer)
      resolve(url)
    }
    const fail = (error: Error) => {
      if (settled || timedOut) return
      settled = true
      if (clock.timer !== undefined) clearTimeout(clock.timer)
      reject(error)
    }
    const take = (chunk: string) => {
      if (settled || timedOut) return
      buffer += chunk
      if (buffer.length > 256 * 1024) {
        const cut = buffer.lastIndexOf('\n')
        buffer = cut === -1 ? buffer.slice(-8 * 1024) : buffer.slice(cut + 1)
      }
      const url = URL_RE.exec(buffer)?.[1]
      if (url !== undefined) succeed(url)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    child.once('error', (error) => fail(error))
    child.once('exit', (code, signal) => {
      if (settled || timedOut) return
      const how = code === null ? `signal ${signal ?? 'unknown'}` : `exit ${code}`
      fail(new Error(`dsh exited (${how}) before printing a token URL`))
    })
    clock.timer = setTimeout(() => {
      if (settled) return
      timedOut = true
      void killChild(child).then(() => {
        if (settled) return
        settled = true
        reject(new Error('timeout waiting for the dsh host to print its URL'))
      })
    }, timeoutMs)
  })
}

export async function startHost(opts: HostRunOptions): Promise<RunningHost> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const env = childEnv(opts.dshHome)
  await runToExit(
    opts.dsh,
    ['--profile', opts.profile, '--from-default-profile', 'web', '--dump-config'],
    env,
    timeoutMs,
    '--dump-config',
  )
  await runToExit(opts.dsh, ['plugin', '--profile', opts.profile, 'add', opts.tarball], env, timeoutMs, 'plugin add')
  const child = spawn(
    opts.dsh,
    ['--profile', opts.profile, '--no-open', '--host', '127.0.0.1', '--port', String(opts.port)],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  tieToProcessExit(child)
  const baseUrl = await waitForUrl(child, timeoutMs)
  let stopping: Promise<void> | undefined
  return {
    baseUrl,
    stop() {
      stopping ??= killChild(child)
      return stopping
    },
  }
}

/** Replaces the token query value. The rest of the URL stays so the log line is still recognisable. */
function redactBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/([?&]token=)[^&\s#]*/, '$1<redacted>')
}

const FLAGS = ['--dsh', '--home', '--profile', '--tarball', '--port'] as const

function parseCli(args: readonly string[]): HostRunOptions | undefined {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (flag === undefined || !FLAGS.some((known) => known === flag) || values.has(flag)) return undefined
    const value = args[index + 1]
    if (value === undefined || value === '' || value.startsWith('--')) return undefined
    values.set(flag, value)
    index += 1
  }
  const dsh = values.get('--dsh')
  const dshHome = values.get('--home')
  const profile = values.get('--profile')
  const tarball = values.get('--tarball')
  const portText = values.get('--port')
  if (
    dsh === undefined ||
    dshHome === undefined ||
    profile === undefined ||
    tarball === undefined ||
    portText === undefined
  ) {
    return undefined
  }
  if (!/^\d+$/.test(portText)) return undefined
  const port = Number(portText)
  if (port < 1 || port > 65535) return undefined
  return { dsh, dshHome, profile, tarball, port }
}

async function runCli(args: readonly string[]): Promise<number> {
  const opts = parseCli(args)
  if (opts === undefined) {
    console.error(USAGE)
    return 2
  }
  let running: RunningHost
  try {
    running = await startHost(opts)
  } catch (error) {
    console.error(`host-run: ${messageOf(error)}`)
    return 1
  }
  try {
    await writeFile(join(opts.dshHome, HOST_BASE_URL_FILE), `${running.baseUrl}\n`, { mode: 0o600 })
  } catch (error) {
    await running.stop()
    console.error(`host-run: ${messageOf(error)}`)
    return 1
  }
  console.log(JSON.stringify({ baseUrl: redactBaseUrl(running.baseUrl) }))
  await new Promise<void>((resolve) => {
    const onSignal = () => {
      process.off('SIGINT', onSignal)
      process.off('SIGTERM', onSignal)
      resolve()
    }
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  })
  await running.stop()
  return 0
}

if (isInvokedAsScript(process.argv[1], import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2))
}
