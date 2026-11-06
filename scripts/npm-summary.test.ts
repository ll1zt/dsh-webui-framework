import { describe, expect, it } from 'vitest'
import { summarizeNpmError } from './npm-summary.ts'
import type { NpmConflict, NpmSummary } from './npm-summary.ts'

/** npm ERESOLVE text in the shape of the alpha install failures (Found / peer / Conflicting peer dependency). */
const ERESOLVE_LOG = [
  'npm error code ERESOLVE',
  'npm error ERESOLVE could not resolve',
  'npm error',
  'npm error While resolving: @lllzt/dsh-webui-framework@0.4.0',
  'npm error Found: @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
  'npm error node_modules/@deepseek-ai/dsh-web-app',
  'npm error   dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
  'npm error',
  'npm error Could not resolve dependency:',
  'npm error peer @deepseek-ai/dsh-shell-env@"0.2.2-alpha.3" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
  'npm error node_modules/@deepseek-ai/dsh-web-app',
  'npm error   dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
  'npm error',
  'npm error Conflicting peer dependency: @deepseek-ai/dsh-shell-env@0.2.2-alpha.3',
  'npm error node_modules/@deepseek-ai/dsh-shell-env',
  'npm error   peer @deepseek-ai/dsh-shell-env@"0.2.2-alpha.3" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
  'npm error   node_modules/@deepseek-ai/dsh-web-app',
  'npm error     dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
  'npm error',
  'npm error Found: @deepseek-ai/cordis@4.1.0',
  'npm error node_modules/@deepseek-ai/cordis',
  'npm error   @deepseek-ai/cordis@"4.1.0" from the root project',
  'npm error',
  'npm error Could not resolve dependency:',
  'npm error peer @deepseek-ai/cordis@"~4.0.6-alpha.1" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
  'npm error node_modules/@deepseek-ai/dsh-web-app',
  'npm error   dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
  'npm error',
  'npm error Conflicting peer dependency: @deepseek-ai/cordis@4.0.6-alpha.1',
  'npm error node_modules/@deepseek-ai/cordis',
  'npm error   peer @deepseek-ai/cordis@"~4.0.6-alpha.1" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
  'npm error   node_modules/@deepseek-ai/dsh-web-app',
  'npm error     dev @deepseek-ai/dsh-web-app@"0.2.2-alpha.2" from the root project',
  'npm error',
  'npm error Fix the upstream dependency conflict, or retry',
  'npm error this command with --force or --legacy-peer-deps',
  'npm error to accept an incorrect (and potentially broken) dependency resolution.',
  'npm error',
  'npm error /home/runner/.npm/_logs/2026-04-01T00_00_00_000Z-debug-0.log',
  'npm error https://registry.example.com/@deepseek-ai/cordis?token=ghp_0123456789abcdef0123456789abcdef01234567',
  'npm error cookie=sessionid=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'npm error token={{SECRET_k3m8q2x7}}',
].join('\n')

const E404_LOG = [
  'npm error code E404',
  'npm error Found: @deepseek-ai/cordis@4.1.0',
  'npm error peer @deepseek-ai/cordis@"~4.0.6-alpha.1" from @deepseek-ai/dsh-web-app@0.2.2-alpha.2',
  'npm error 404 Not Found - GET https://registry.npmmirror.com/@deepseek-ai%2fmissing - Not found',
  'npm error 404',
  "npm error 404  '@deepseek-ai/missing@9.9.9' is not in this registry.",
  'npm error 404 Note that you can also install from a',
  'npm error 404 tarball, folder, http url, or git url.',
  'npm error /home/runner/.npm/_logs/2026-04-01T00_00_00_000Z-debug-0.log',
  'npm error 404 Not Found',
  'added 1 package in 2s',
].join('\n')

const CONFLICTS: readonly NpmConflict[] = [
  { package: '@deepseek-ai/cordis', versions: ['4.1.0', '~4.0.6-alpha.1', '4.0.6-alpha.1'] },
  { package: '@deepseek-ai/dsh-shell-env', versions: ['0.2.2-alpha.3'] },
  { package: '@deepseek-ai/dsh-web-app', versions: ['0.2.2-alpha.2'] },
]

const SUMMARY =
  'ERESOLVE: 3 conflicting package(s): @deepseek-ai/cordis@4.1.0, @deepseek-ai/dsh-shell-env@0.2.2-alpha.3, @deepseek-ai/dsh-web-app@0.2.2-alpha.2'

describe('summarizeNpmError', () => {
  it('A1 lists each conflicting package and version from an ERESOLVE log, with a one-line summary and no token or path', () => {
    const result: NpmSummary = summarizeNpmError(ERESOLVE_LOG)

    expect(result.conflicts).toEqual(CONFLICTS)
    expect(result.summary).toBe(SUMMARY)
    expect(result.summary).not.toMatch(/\n/)
    expect(result.summary).not.toContain('ghp_0123456789abcdef0123456789abcdef01234567')
    expect(result.summary).not.toContain('{{SECRET_k3m8q2x7}}')
    expect(result.summary).not.toContain('cookie=')
    expect(result.summary).not.toContain('?token=')
    expect(result.summary).not.toContain('/home/')
    expect(result.summary).not.toContain('node_modules')
  })

  it('A2 returns no conflicts and the last npm error line when the log is not ERESOLVE', () => {
    expect(summarizeNpmError(E404_LOG)).toEqual({ summary: '404 Not Found', conflicts: [] })
    expect(summarizeNpmError('added 1 package in 2s\n')).toEqual({ summary: '', conflicts: [] })
  })
})
