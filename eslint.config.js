import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

// React 19-only APIs: the dsh shell seeds React 18 (docs/01 C1).
const REACT_19_ONLY = ['use', 'useActionState', 'useOptimistic', 'useFormStatus']

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
      'no-restricted-imports': ['error', {
        paths: [{ name: 'react', importNames: REACT_19_ONLY, message: 'React 19-only API; the dsh shell runs React 18.' }],
      }],
    },
  },
  {
    // Components read data only through standard hooks and inject faces (docs/01 A12).
    files: ['src/ui/**/*.{ts,tsx}', 'src/client/entries/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', importNames: [...REACT_19_ONLY, 'useSyncExternalStore'], message: 'Components must not subscribe on their own (A12) or use React 19 APIs.' },
          { name: 'use-sync-external-store', message: 'Components must not subscribe on their own (A12).' },
        ],
      }],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs,ts}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
)
