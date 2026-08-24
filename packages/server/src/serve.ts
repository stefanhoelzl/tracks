import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'
import { createApi } from './api.ts'
import type { Db } from './db.ts'

/**
 * `tracks serve`.
 *
 * In development the Hono app runs inside Vite instead, so one command HMRs both
 * sides and this file is not involved. Here it mounts the built browser bundle
 * beside the API — the production path, and the only one that has to work offline.
 */

export interface ServeOptions {
  port: number
  /** Where `vite build` put the browser bundle. */
  webRoot: string
  open?: boolean
}

/**
 * Throws rather than serving a 404 when there is no build: an empty page with a
 * working API is a puzzle, and the answer is one named command.
 */
export function createServer(db: Db, webRoot: string): Hono {
  if (!existsSync(webRoot)) {
    throw new Error(`no web build found at ${webRoot} — run: pnpm build`)
  }

  const app = createApi(db)
  // serveStatic falls back to index.html for a directory, which covers `/` — the
  // only path this app has, since its whole state is the query string.
  app.use('/*', serveStatic({ root: webRoot }))

  return app
}

/** Best-effort, and deliberately silent on failure — the URL is already printed. */
function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  execFile(command, [url], () => {})
}

export function startServer(db: Db, options: ServeOptions): void {
  const app = createServer(db, options.webRoot)

  serve({ fetch: app.fetch, port: options.port }, (info) => {
    const url = `http://localhost:${info.port}`
    console.log(`tracks serving on ${url}`)
    if (options.open) openBrowser(url)
  })
}
