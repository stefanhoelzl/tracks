import { resolve } from 'node:path'
import devServer from '@hono/vite-dev-server'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * One command, both sides.
 *
 * `@hono/vite-dev-server` runs the real Hono app inside Vite's module runner, so an
 * API edit reloads on the same watcher as a component edit and there is one port to
 * remember. `tracks serve` is the production path and does not involve Vite at all.
 *
 * better-sqlite3 is a native addon and drizzle is CJS: both have to be required by
 * Node rather than transformed, which is what `ssr.external` means here.
 */
export default defineConfig({
  plugins: [
    react(),
    devServer({
      entry: resolve(import.meta.dirname, 'src/dev-server.ts'),
      exclude: [/^\/(?!api\/).*/],
    }),
  ],
  ssr: {
    external: ['better-sqlite3', 'drizzle-orm', '@mapbox/polyline'],
  },
  build: {
    // Named so `tracks serve` can find it without configuration.
    outDir: 'dist',
  },
})
