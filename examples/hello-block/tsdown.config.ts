import { defineConfig, type UserConfig } from 'tsdown'

const PLUGIN_ID = '@lllzt/dsh-webui-hello-block'

/** The host loads the bundle from a classic <script> tag, so the file body is exactly one loader call. */
const BANNER = `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`
const INTRO = 'var module = { exports: {} }; var exports = module.exports;'
const FOOTER = 'return module.exports; } });'

/** Modules the host provides; the bundle `require`s them instead of carrying a copy. */
const HOST_MODULES = new Set(['react', 'react/jsx-runtime', 'react-dom'])

const nodeHalf: UserConfig = {
  name: `${PLUGIN_ID}/node`,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  clean: false,
}

const clientHalf: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  clean: false,
  deps: {
    neverBundle: (specifier: string) => HOST_MODULES.has(specifier),
    alwaysBundle: (specifier: string) => !HOST_MODULES.has(specifier),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: BANNER,
    intro: INTRO,
    footer: FOOTER,
  },
}

export default defineConfig([nodeHalf, clientHalf])
