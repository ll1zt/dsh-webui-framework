import { execPath } from 'node:process'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { startHost } from './host-run.ts'

/**
 * Stand-in for the dsh launcher. Three shapes, matching a real rc.1 startup:
 * `--from-default-profile` + `--dump-config` exits 0 with no URL and no pid;
 * `plugin` exits 0; anything else is the host (pid file, and in `serve` mode one URL line).
 * The host waits for SIGTERM and writes a marker before exiting. Nothing here listens.
 */

type FakeMode = 'serve' | 'silent' | 'stderr-token'

interface RecordedCall {
  argv: string[]
  HOME: string | null
  DSH_HOME: string | null
}

interface FakeDsh {
  dir: string
  bin: string
  logPath: string
  pidPath: string
  markerPath: string
  home: string
  token: string
  port: number
  profile: string
  tarball: string
}

const PORT = 45731
const PROFILE = 'web-smoke'

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const readCalls = (logPath: string): RecordedCall[] => {
  if (!existsSync(logPath)) return []
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as RecordedCall)
}

const readPid = (pidPath: string): number => Number(readFileSync(pidPath, 'utf8'))

const makeFake = async (mode: FakeMode, token: string): Promise<FakeDsh> => {
  const dir = await mkdtemp(join(tmpdir(), 'host-run-'))
  const home = join(dir, 'home')
  await mkdir(home)
  const logPath = join(dir, 'calls.ndjson')
  const pidPath = join(dir, 'host.pid')
  const markerPath = join(dir, 'stopped')
  const tarball = join(dir, 'framework.tgz')
  await writeFile(tarball, 'not a real package')
  const bin = join(dir, 'dsh')
  const script = [
    `#!${execPath}`,
    `const { appendFileSync, writeFileSync } = require('node:fs')`,
    `const argv = process.argv.slice(2)`,
    `appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ argv, HOME: process.env.HOME ?? null, DSH_HOME: process.env.DSH_HOME ?? null }) + '\\n')`,
    `if (argv.includes('--from-default-profile') && argv.includes('--dump-config')) process.exit(0)`,
    `if (argv[0] === 'plugin') process.exit(0)`,
    `writeFileSync(${JSON.stringify(pidPath)}, String(process.pid))`,
    `const mode = ${JSON.stringify(mode)}`,
    `const token = ${JSON.stringify(token)}`,
    `if (mode === 'serve') {`,
    `  const portAt = argv.indexOf('--port')`,
    `  const port = portAt === -1 ? '' : argv[portAt + 1]`,
    `  process.stdout.write('ready\\n')`,
    `  process.stdout.write('http://127.0.0.1:' + port + '/?token=' + token + '\\n')`,
    `} else if (mode === 'stderr-token') {`,
    `  process.stderr.write(token + '\\n')`,
    `}`,
    `process.on('SIGTERM', () => {`,
    `  writeFileSync(${JSON.stringify(markerPath)}, 'sigterm\\n')`,
    `  process.exit(0)`,
    `})`,
    `setInterval(() => {}, 1000)`,
    '',
  ].join('\n')
  await writeFile(bin, script)
  await chmod(bin, 0o755)
  return { dir, bin, logPath, pidPath, markerPath, home, token, port: PORT, profile: PROFILE, tarball }
}

const killHost = (pidPath: string) => {
  if (!existsSync(pidPath)) return
  const pid = readPid(pidPath)
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // already exited
  }
}

const cleanup = async (fake: FakeDsh) => {
  killHost(fake.pidPath)
  await rm(fake.dir, { recursive: true, force: true })
}

const optsFor = (fake: FakeDsh, timeoutMs?: number) => ({
  dsh: fake.bin,
  dshHome: fake.home,
  profile: fake.profile,
  tarball: fake.tarball,
  port: fake.port,
  ...(timeoutMs === undefined ? {} : { timeoutMs }),
})

it('A1 startHost returns the printed baseUrl and stop ends the child', async () => {
  const fake = await makeFake('serve', 'tok_a1_9f3c')
  const parentHome = process.env.HOME
  const parentDshHome = process.env.DSH_HOME
  try {
    const running = await startHost(optsFor(fake))
    expect(running.baseUrl).toBe(`http://127.0.0.1:${fake.port}/?token=${fake.token}`)

    const calls = readCalls(fake.logPath)
    expect(calls.map((call) => call.argv)).toEqual([
      ['--profile', fake.profile, '--from-default-profile', 'web', '--dump-config'],
      ['plugin', '--profile', fake.profile, 'add', fake.tarball],
      ['--profile', fake.profile, '--no-open', '--host', '127.0.0.1', '--port', String(fake.port)],
    ])
    for (const call of calls) {
      expect(call.HOME).toBe(fake.home)
      expect(call.DSH_HOME).toBe(fake.home)
    }
    expect(process.env.HOME).toBe(parentHome)
    expect(process.env.DSH_HOME).toBe(parentDshHome)

    expect(existsSync(fake.pidPath)).toBe(true)
    const pid = readPid(fake.pidPath)
    expect(alive(pid)).toBe(true)
    await running.stop()
    await expect.poll(() => existsSync(fake.markerPath) && !alive(pid), { interval: 20, timeout: 2000 }).toBe(true)
  } finally {
    if (parentHome === undefined) delete process.env.HOME
    else process.env.HOME = parentHome
    if (parentDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = parentDshHome
    await cleanup(fake)
  }
})

it('A2 startHost times out when no URL is printed and the error omits the token', async () => {
  const fake = await makeFake('silent', 'tok_silent_9f3c')
  try {
    const error = await startHost(optsFor(fake, 400)).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('timeout')
    expect(message).not.toContain(fake.token)
    expect(existsSync(fake.pidPath)).toBe(true)
    const pid = readPid(fake.pidPath)
    await expect.poll(() => alive(pid), { interval: 20, timeout: 2000 }).toBe(false)
  } finally {
    await cleanup(fake)
  }
}, 5000)

it('A2 a token printed only on stderr is not in the timeout error', async () => {
  const fake = await makeFake('stderr-token', 'tok_stderr_9f3c')
  try {
    const error = await startHost(optsFor(fake, 400)).then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('timeout')
    expect(message).not.toContain(fake.token)
    expect(existsSync(fake.pidPath)).toBe(true)
    const pid = readPid(fake.pidPath)
    await expect.poll(() => alive(pid), { interval: 20, timeout: 2000 }).toBe(false)
  } finally {
    await cleanup(fake)
  }
}, 5000)
