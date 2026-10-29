import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// React 19-only APIs: the dsh shell seeds React 18 (docs/01 C1).
const REACT_19_ONLY = ['use', 'useActionState', 'useOptimistic', 'useFormStatus']

// Single-exit guards (PRINCIPLES §1.4): each literal lives in one module. Module specifiers of
// import/export are not literal uses. Flat-config options do not merge across blocks, so every
// file gets the one complete list that applies to it; exemptions are file globs, never comments.
// Tests and scripts/fixtures keep their own expected values as an oracle (D26).
const NOT_MODULE_SPECIFIER =
  ':not(ImportDeclaration, ExportAllDeclaration, ExportNamedDeclaration, ImportExpression, TSExternalModuleReference, TSModuleDeclaration)'

/** Selectors that match a string literal or template fragment whose text satisfies `test` (an esquery attr operator + value). */
function textSelectors(test) {
  return [
    `${NOT_MODULE_SPECIFIER} > Literal[value${test}]`,
    `TemplateLiteral > TemplateElement:first-child[value.cooked${test}]`,
  ]
}

const PLUGIN_ID_GUARDS = [
  ...textSelectors('="@lllzt/dsh-webui-framework"').map((selector) => ({
    selector,
    message: 'The plugin id is named once, in scripts/plugin-constants.ts (PLUGIN_ID); import it from there.',
  })),
  ...textSelectors('="@deepseek-ai/dsh-client-ui-dockkit"').map((selector) => ({
    selector,
    message: 'The seed-list sentinel is named once, in scripts/plugin-constants.ts; import it from there.',
  })),
]
const STORAGE_PREFIX_GUARDS = textSelectors('=/^dsh-web-ui:/').map((selector) => ({
  selector,
  message:
    "Storage keys (the 'dsh-web-ui:' prefix) are built only in src/lib/storage-keys.ts; import a key from there.",
}))
const SLOT_KEY_GUARDS = textSelectors('=/^webui[.]/').map((selector) => ({
  selector,
  message: 'Slot keys (the webui. prefix) are declared only in src/client/types.ts.',
}))
const HTML_SINK_GUARDS = [
  {
    selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
    message: 'Unsanitized HTML is not allowed. Do not use dangerouslySetInnerHTML.',
  },
]
const COMPONENT_CTX_GUARDS = [
  {
    selector: 'Identifier[name="ctx"]',
    message: 'Components do not receive or close over ctx. Data and actions arrive through props.',
  },
]
// Test titles open with their acceptance item: `A<n> ` then a lowercase description.
const TEST_TITLE_GUARDS = [
  {
    selector: 'CallExpression[callee.name=/^(it|test)$/] > Literal:first-child[value!=/^A\\d+ /]',
    message: 'A test title must start with its acceptance item, A<n> followed by a space (e.g. "A1 does x").',
  },
]

export default tseslint.config(
  { ignores: ['lib/', 'node_modules/', 'ref/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme'], location: 'start' }],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', importNames: REACT_19_ONLY, message: 'React 19-only API; the dsh shell runs React 18.' },
          ],
        },
      ],
    },
  },
  {
    // Components read data only through standard hooks and inject faces (docs/01 A12).
    files: ['src/ui/**/*.{ts,tsx}', 'src/client/entries/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              importNames: [...REACT_19_ONLY, 'useSyncExternalStore'],
              message: 'Components must not subscribe on their own (A12) or use React 19 APIs.',
            },
            { name: 'use-sync-external-store', message: 'Components must not subscribe on their own (A12).' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    ignores: ['scripts/plugin-constants.ts', 'scripts/fixtures/**', '**/*.test.*'],
    rules: { 'no-restricted-syntax': ['error', ...PLUGIN_ID_GUARDS] },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/lib/storage-keys.ts', 'src/client/types.ts', '**/*.test.*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...STORAGE_PREFIX_GUARDS,
        ...PLUGIN_ID_GUARDS,
        ...SLOT_KEY_GUARDS,
        ...HTML_SINK_GUARDS,
      ],
    },
  },
  {
    // src/client/types.ts is the one module allowed to name slot keys, so it drops that one guard.
    files: ['src/client/types.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...STORAGE_PREFIX_GUARDS, ...PLUGIN_ID_GUARDS, ...HTML_SINK_GUARDS],
    },
  },
  {
    // Components never see ctx. This block replaces the src block's rule list, so the shared guards
    // are repeated here.
    files: ['src/ui/**/*.{ts,tsx}', 'src/client/entries/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...STORAGE_PREFIX_GUARDS,
        ...PLUGIN_ID_GUARDS,
        ...SLOT_KEY_GUARDS,
        ...HTML_SINK_GUARDS,
        ...COMPONENT_CTX_GUARDS,
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...TEST_TITLE_GUARDS, ...HTML_SINK_GUARDS] },
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
