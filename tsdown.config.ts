import { readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { transform } from 'lightningcss'
import { defineConfig, type TsdownPlugin, type UserConfig } from 'tsdown'
import { styleInjectionModule } from './scripts/css-inject.ts'
import { PLUGIN_ID, isSeedModule } from './scripts/plugin-constants.ts'

/** Package root: tsdown runs with it as the working directory, and the CSS virtual ids stay relative to it. */
const PACKAGE_ROOT = import.meta.dirname

/**
 * The host loads the bundle from a classic <script> tag, so the file body is
 * exactly one `window.__ModuleLoader__.load(...)` call (02 §8.1). These strings
 * are the contract; {@link loaderWrapper} writes them byte-exact.
 */
const BANNER = `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`
const INTRO = 'var module = { exports: {} }; var exports = module.exports;'
const FOOTER = 'return module.exports; } });'

/**
 * Rolldown parses the configured banner/intro/footer and reprints them across
 * lines, so the loader call itself is assembled after generation. Both markers
 * below belong to the fragments above, never to bundled module code.
 */
const BANNER_TAIL = 'factory: (require) => {'
const FOOTER_HEAD = 'return module.exports;'

/**
 * Virtual-id wrapper keeping stylesheets away from tsdown's own css pipeline,
 * which claims ids ending in `.css` (and needs `@tsdown/css` to serve them).
 * The virtual id ends in a JavaScript extension so that pipeline lets it pass.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** `import './x.css'` becomes a side-effect module carrying the minified sheet and its injection. */
function cssAsInjectedStyle(): TsdownPlugin {
  return {
    name: 'dsh-css-as-injected-style',
    resolveId: {
      order: 'pre' as const,
      handler(source: string, importer: string | undefined) {
        if (!source.endsWith('.css') || importer === undefined) return null
        const file = resolve(dirname(importer), source)
        // Relative to the package so the emitted module comment carries no build-machine path.
        return CSS_VIRTUAL_PREFIX + relative(PACKAGE_ROOT, file) + CSS_VIRTUAL_SUFFIX
      },
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = resolve(PACKAGE_ROOT, virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length))
      // The virtual id hides the physical sheet from rolldown's watch graph.
      this.addWatchFile(fileId)
      const { code } = transform({ filename: fileId, code: await readFile(fileId), minify: true })
      return styleInjectionModule(PLUGIN_ID, relative(PACKAGE_ROOT, fileId), code.toString())
    },
  }
}

/** First line of the body after the loader call has been reassembled, 1-based. */
const WRAPPED_BODY_LINE = 2

/**
 * Rewrite the emitted entry so the banner is the first bytes and the footer the
 * last, and keep the published source map's line numbers pointing at the body
 * they were generated for. The generated map's first mapped line sits in the
 * module body, whose text is preserved verbatim, so shifting its unmapped
 * leading lines is enough.
 */
function loaderWrapper(): TsdownPlugin {
  return {
    name: 'dsh-loader-wrapper',
    async writeBundle(outputOptions, bundle) {
      const dir = outputOptions.dir
      if (dir === undefined) return
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk' || !output.isEntry) continue
        const file = resolve(dir, output.fileName)
        const emitted = await readFile(file, 'utf8')
        const bannerTail = emitted.indexOf(BANNER_TAIL)
        const footerHead = emitted.lastIndexOf(FOOTER_HEAD)
        if (bannerTail < 0 || footerHead < bannerTail) {
          throw new Error(`dsh-loader-wrapper: ${output.fileName} does not carry the configured banner and footer`)
        }
        // The rewrite below repaints only whitespace, so anything else rolldown
        // might do to the fragments must fail the build instead of the browser.
        if (collapseWhitespace(emitted.slice(0, bannerTail + BANNER_TAIL.length)) !== BANNER) {
          throw new Error(`dsh-loader-wrapper: ${output.fileName} banner is not a reflow of ${JSON.stringify(BANNER)}`)
        }
        if (collapseWhitespace(emitted.slice(footerHead)) !== FOOTER) {
          throw new Error(`dsh-loader-wrapper: ${output.fileName} footer is not a reflow of ${JSON.stringify(FOOTER)}`)
        }
        const body = emitted.slice(bannerTail + BANNER_TAIL.length, footerHead).trimEnd()
        const originalBodyLine = emitted.slice(0, bannerTail).split('\n').length + 1
        await writeFile(file, `${BANNER}${body}\n${FOOTER}\n`)

        const mapFile = `${file}.map`
        const generatedMap = await readFile(mapFile, 'utf8').catch(() => undefined)
        if (generatedMap === undefined) continue
        const map = JSON.parse(generatedMap) as { mappings: string }
        map.mappings = shiftMappings(map.mappings, WRAPPED_BODY_LINE - originalBodyLine)
        await writeFile(mapFile, JSON.stringify(map))
      }
    },
  }
}

/** Compare a reflowed fragment with its configured text: rolldown may only re-indent it. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

/**
 * Move every generated mapping by `shift` lines, positive meaning later.
 * Mappings for lines that no longer exist are dropped.
 */
function shiftMappings(mappings: string, shift: number): string {
  if (shift === 0) return mappings
  const lines = mappings.split(';')
  return shift > 0
    ? [...Array<string>(shift).fill(''), ...lines].join(';')
    : lines.slice(-shift).join(';')
}

/**
 * The Node half the host Loader imports. It stays ESM and carries no browser
 * code, so the plugin's host-side surface is one `apply` export.
 */
const nodeHalf: UserConfig = {
  name: `${PLUGIN_ID}/node`,
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  clean: false,
}

/**
 * The browser half: one self-contained CommonJS bundle inside the loader call.
 * `clean` stays off because this invocation shares `lib/` with the Node half.
 */
const clientHalf: UserConfig = {
  name: `${PLUGIN_ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  clean: false,
  // The map ships beside the bundle; the footer must remain the last bytes, so
  // no `sourceMappingURL` comment may follow it.
  sourcemap: 'hidden',
  deps: {
    neverBundle: isSeedModule,
    alwaysBundle: (specifier: string) => !isSeedModule(specifier),
  },
  // tsdown builds a CommonJS output on the node platform, so the browser
  // resolution an inlined dependency needs must be stated here (03 §1.2).
  inputOptions: {
    resolve: { conditionNames: ['production', 'browser', 'import', 'module', 'default'], mainFields: ['browser', 'module', 'main'] },
  },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.MODE': '"production"',
  },
  plugins: [cssAsInjectedStyle(), loaderWrapper()],
  outputOptions: {
    entryFileNames: 'client.js',
    chunkFileNames: 'client.[name].js',
    banner: BANNER,
    intro: INTRO,
    footer: FOOTER,
  },
}

export default defineConfig([nodeHalf, clientHalf])
