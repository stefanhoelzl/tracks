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
    include: ['src/**/*.test.tsx'],
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
