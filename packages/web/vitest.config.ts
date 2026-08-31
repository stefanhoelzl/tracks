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
  },
})
