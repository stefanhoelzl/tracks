import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Its own config rather than a share of `vite.config.ts`: that one mounts the Hono
 * app through the dev-server plugin, which would open the database to run a
 * component test.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'web',
    // `.ts` as well as `.tsx`: the sources moved here from the server and have no JSX,
    // but they are browser code now — DOMParser, DecompressionStream, zip.js — so they
    // belong in the lane that has a DOM rather than the one that does not.
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    /**
     * Vitest's 5 s is a unit test's budget, and this lane does not run unit tests.
     * `App.test.tsx` mounts the entire application — every module it imports, a jsdom
     * document, four mocked routes and a react-query cache — which is a second or two
     * on an idle machine and several on a busy one. It grew again in M8, and it was
     * the first thing to fall over on a loaded laptop while everything it asserts was
     * still correct. A timeout that fires on contention rather than on a hang is a
     * flake, and a flake is worse than a slow test.
     */
    testTimeout: 20_000,
  },
})
