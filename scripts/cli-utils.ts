import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The message of an `Error`, or the string form of anything else that was thrown. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Whether the module at `moduleUrl` is the entry script node was started with (`argv1` is `process.argv[1]`). */
export function isInvokedAsScript(argv1: string | undefined, moduleUrl: string): boolean {
  return argv1 !== undefined && resolve(argv1) === fileURLToPath(moduleUrl)
}
