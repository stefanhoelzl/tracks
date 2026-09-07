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
const url = Deno.env.get('TRACKS_DB_URL')
const authToken = Deno.env.get('TRACKS_DB_TOKEN')
if (!url) throw new Error('TRACKS_DB_URL is not set')

const db = connect(createClient({ url, authToken }))

// `crossSite` is deliberately not passed. It exists for the Simple Browser, which
// frames the dev server; a deployment is visited at its own origin and keeps `Lax`.
const app = createApi(db)

export default serveAssets(app, assets)
