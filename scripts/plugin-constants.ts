/**
 * The one place that names this plugin and the platform's seed modules. The build config, the
 * bundle verifier and the host smoke all read these, so a change here cannot reach one and miss
 * another.
 *
 * One plugin carries three identifiers, each answering a different question:
 * - PLUGIN_ID `@lllzt/dsh-webui-framework`: the package name, and the id the host's loader keys the bundle by.
 * - PLUGIN_ROW_ID `pi-ui`: the row id of our `insert` entry in cordis.patch.yml's assembly table.
 * - `name = 'dsh-web-ui'` exported by src/client/index.ts: the cordis plugin name. src cannot
 *   import from scripts/, so that correspondence is recorded here and nowhere in code.
 *
 * The test files (verify-bundle.test.ts and friends) keep their own independent expected values
 * on purpose: they are the oracle that catches this module being edited by mistake.
 *
 * This module imports no other repo file, because the build config and every script depend on it.
 */

/** The loader module-table id, the id stamped into the loader call, and the owner of our injected styles. */
export const PLUGIN_ID = '@lllzt/dsh-webui-framework'

/** The id of our row in cordis.patch.yml's last `insert` entry. */
export const PLUGIN_ROW_ID = 'pi-ui'

/** Module-table rows the host answers for every plugin; every other specifier is inlined (02 §8.2). */
export const SEED_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** Exact match: `react-dom/server` is not a seed just because `react-dom` is. */
export function isSeedModule(specifier: string): boolean {
  return SEED_MODULES.includes(specifier)
}
