import { resolve } from 'node:path'
import { createApi } from '../../server/src/api.ts'
import { openDb } from '../../server/src/db.ts'

/**
 * The dev entry point: the same API the CLI serves, opened against the same file.
 *
 * Deliberately not the whole of `tracks serve` — Vite is serving the browser bundle
 * here, so mounting a `dist` that does not exist yet would be the one difference
 * that makes development lie about production.
 */
/**
 * A URL rather than a path, because the client behind it takes both: `file:` opens the
 * embedded libSQL in this process, and an `https:` URL is Bunny Database.
 *
 * Required, with no fallback. It used to default to `data/tracks.db`, which was right
 * while that file was the truth and became a trap the moment it was not: with the file
 * deleted, `openDb` would create and migrate an empty one, and development would come
 * up working and empty rather than pointing at the database that has the activities in
 * it. Saying which database you mean is one line in a shell; guessing wrong is an
 * afternoon of wondering where 203 activities went.
 */
const url = process.env.TRACKS_DB_URL
if (!url) {
  throw new Error(
    'TRACKS_DB_URL is not set. Point it at the deployed database, or at a local file ' +
      "for offline work: TRACKS_DB_URL='file:data/tracks.db' pnpm dev",
  )
}

const { db } = await openDb(
  url,
  resolve(import.meta.dirname, '../../../migrations'),
  process.env.TRACKS_DB_TOKEN,
)

/**
 * `crossSite` because the app is looked at through VS Code's Simple Browser, which
 * renders it in a `vscode-webview://` iframe. A `SameSite=Lax` cookie is not stored in
 * a cross-site frame at all, so signing in there succeeds and the very next request
 * arrives anonymous.
 *
 * This is the one thing the dev server does differently from a deployment, and it is
 * written down rather than inferred: production is `Lax`, and nothing sets this but
 * this file.
 */
export default createApi(db, { crossSite: true })
