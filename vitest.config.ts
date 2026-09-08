import { defineConfig } from 'vitest/config'

/**
 * Two lanes, on purpose.
 *
 * `node` is the import, query, account and edge work: no jsdom, no browser, and it stays
 * offline — `vitest --project node` is the loop to run while changing a parser or a
 * filter. It is no longer under a second: signing in really does 600k PBKDF2 rounds,
 * and the handful of tests that go through `POST /api/session` pay for it on purpose,
 * because a cheap hash in the tests would prove the wrong thing about the one route
 * that must be right. Everything not about hashing passes a low cost instead.
 *
 * `web` is the components, which need a DOM and cost what a DOM costs. Keeping them
 * apart is what stops the fast lane quietly becoming the slow one.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: [
            'packages/core/src/**/*.test.ts',
            'packages/server/src/**/*.test.ts',
            'packages/edge/src/**/*.test.ts',
            'packages/routing/src/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      './packages/web/vitest.config.ts',
    ],
  },
})
