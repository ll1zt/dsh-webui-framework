import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DISABLED_ROW_IDS = [
  'ui-layout',
  'ui-sidebar',
  'ui-sidebar-right',
  'ui-sidebar-documentpreview',
  'ui-sidebar-browser',
  'ui-sidebar-terminal',
  'ui-sidebar-files',
  'ui-workspace',
  'ui-conversation',
  'ui-chat',
  'ui-deliverables',
  'ui-plan',
  'ui-skill',
  'ui-reference',
  'ui-schedule',
  'ui-subagent',
  'ui-workflow-run',
  'entry-customization',
  'ui-secret-mask',
  'ui-goal',
  'ui-trajectory',
  'message-quotes',
  'ui-tool',
  'ui-brand-official',
  'ui-attachment',
  'ui-shortcuts',
  'ui-jobs',
  'ui-cordis',
  'ui-deepseek-model-label-1017',
  'ui-message-feedback',
  'ui-permission',
  'ui-agent-preset',
  'ui-plugin-manager',
  'ui-open-in-app',
  'directory-picker',
  'ui-approval',
  'ui-user-questions',
  'ui-settings-general',
  'ui-settings-models',
  'ui-settings-account',
  'ui-settings-plugins',
  'ui-settings-plugin-inventory',
  'ui-settings-session-log',
  'ui-settings-shell',
  'ui-settings-agent-loop',
  'ui-settings-subagent',
  'ui-settings-web-search',
]

interface PatchEntry {
  id?: unknown
  disabled?: unknown
  insert?: unknown
}

const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

const readPatch = (): PatchEntry[] => parse(read('cordis.patch.yml')) as PatchEntry[]

const isRow = (entry: PatchEntry): boolean => !('insert' in entry)

const sorted = (values: readonly string[]): string[] => [...values].sort()

describe('cordis.patch.yml', () => {
  it('A1 disables exactly the 47 official rows', () => {
    const entries = readPatch()
    expect(Array.isArray(entries)).toBe(true)
    expect(entries).toHaveLength(48)

    const rows = entries.filter(isRow)
    expect(rows).toHaveLength(47)
    for (const row of rows) {
      expect(sorted(Object.keys(row))).toEqual(['disabled', 'id'])
      expect(typeof row.id).toBe('string')
      expect(row.disabled).toBe(true)
    }

    const ids = rows.map((row) => row.id as string)
    expect(new Set(ids).size).toBe(47)
    expect(sorted(ids)).toEqual(sorted(DISABLED_ROW_IDS))
  })

  it('A2 ends with one insert row of webui-framework', () => {
    const entries = readPatch()
    expect(entries.filter((entry) => 'insert' in entry)).toHaveLength(1)
    expect(entries[entries.length - 1]).toEqual({
      insert: [{ id: 'webui-framework', name: '@lllzt/dsh-webui-framework' }],
    })
  })
})

describe('package manifest', () => {
  interface PackageManifest {
    dsh?: { client?: { platform?: string }; bundle?: { patch?: string } }
    files?: string[]
  }

  it('A3 declares the bundle patch and ships it', () => {
    const manifest = JSON.parse(read('package.json')) as PackageManifest
    expect(manifest.dsh?.client?.platform).toBe('web')
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.files).toContain('cordis.patch.yml')
  })
})
