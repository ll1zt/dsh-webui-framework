import { defineConfig } from 'vitest/config'

// Default environment is node; DOM tests opt in with `// @vitest-environment happy-dom`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.{ts,mjs}'],
    // A shell exporting NODE_ENV=production makes React load its production build,
    // which has no act() and breaks @testing-library; pin the test processes to 'test'.
    env: { NODE_ENV: 'test' },
  },
})
