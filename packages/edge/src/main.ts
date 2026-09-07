import { createClient } from '@libsql/client/web'
import { createApi } from '@tracks/server/api.ts'
import { connect } from '@tracks/server/connect.ts'
import { assets } from './assets.data.ts'
import { serveAssets } from './static.ts'

/**
 * Tracks, as one Edge Script.
 *
 * The same Hono app `pnpm dev` mounts, with the browser bundle served from inside the
 * script rather than by Vite, and a libSQL client pointed at Bunny Database instead of
 * a file. Nothing in `packages/server` knows which of the two it is running under —
 * that is what the M7 work bought, and this file is where it is spent.
 *
 * `@libsql/client/web` rather than the Node build: an isolate has no `node:` anything,
 * and the web build speaks the same HTTP protocol Bunny answers.
 *
 * The client is made once per isolate rather than per request. It holds no socket — it
 * is HTTP — so an idle one costs nothing, and a warm isolate skips the setup.
 */
/**
 * The two variables Bunny injects when a database is connected to a script.
 *
 * Read through both globals rather than importing `node:process`, which is what the
 * documented example does: this bundle is built with esbuild's browser platform
 * precisely so that a stray Node builtin fails the build instead of the first request,
 * and `Deno.env` is the same value without the import. Whichever the runtime provides
 * answers; if neither does, the script says so on boot rather than at the first query.
 */
const env = (name: string) =>
  (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name) ??
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name]

const url = env('BUNNY_DATABASE_URL')
const authToken = env('BUNNY_DATABASE_AUTH_TOKEN')
if (!url) throw new Error('BUNNY_DATABASE_URL is not set — is the database connected?')

const db = connect(createClient({ url, authToken }))

// `crossSite` is deliberately not passed. It exists for the Simple Browser, which
// frames the dev server; a deployment is visited at its own origin and keeps `Lax`.
const app = createApi(db)

export default serveAssets(app, assets)
