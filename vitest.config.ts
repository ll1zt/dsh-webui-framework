import { defineConfig } from 'vitest/config'

// Default environment is node; DOM tests opt in with `// @vitest-environment happy-dom`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
  },
})
