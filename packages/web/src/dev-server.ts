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
const dataDir = process.env.TRACKS_DATA_DIR ?? resolve(import.meta.dirname, '../../../data')
const { db, path } = openDb(
  resolve(dataDir, 'tracks.db'),
  resolve(import.meta.dirname, '../../../migrations'),
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
export default createApi(db, path, { crossSite: true })
