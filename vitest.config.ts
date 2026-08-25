import { defineConfig } from 'vitest/config'

/**
 * Two lanes, on purpose.
 *
 * `node` is the import and query work: no jsdom, no browser, and it stays offline
 * and under a second — `vitest --project node` is the loop to run while changing a
 * parser or a filter. `web` is the components, which need a DOM and cost what a DOM
 * costs. Keeping them apart is what stops the fast lane quietly becoming the slow one.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['packages/core/src/**/*.test.ts', 'packages/server/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      './packages/web/vitest.config.ts',
    ],
  },
})
