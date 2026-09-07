import { existsSync } from 'node:fs'
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
/**
 * Three ways to develop, one variable that picks between them.
 *
 *   pnpm dev         the deployed database, from `.env`
 *   pnpm dev:local   `data/dev.db`, filled by `pnpm db:seed` or `pnpm db:pull`
 *
 * `.env` is read here rather than by Vite, which loads env files for the browser bundle
 * and not for the process this runs in. It is gitignored and holds the deployed
 * database's token, so it is the one file in the repository that must never be
 * committed — hence read explicitly, from one place, rather than by a dependency.
 */
const env = resolve(import.meta.dirname, '../../../.env')
if (existsSync(env)) process.loadEnvFile(env)

/**
 * A relative `file:` URL means relative to the repository, not to whatever directory
 * the dev server happens to start in — which is `packages/web`, because `pnpm dev`
 * filters into it. Left alone, `file:data/dev.db` quietly creates a second, empty
 * database one directory down, and the app comes up signed in with nothing on the map.
 */
const root = resolve(import.meta.dirname, '../../..')
const raw = process.env.TRACKS_DB_URL
const url =
  raw?.startsWith('file:') && !raw.startsWith('file:/')
    ? `file:${resolve(root, raw.slice('file:'.length))}`
    : raw

if (!url) {
  throw new Error(
    'TRACKS_DB_URL is not set.\n' +
      '  pnpm dev:local    against data/dev.db — fill it with `pnpm db:seed` or `pnpm db:pull`\n' +
      '  pnpm dev          against the deployed database — put TRACKS_DB_URL and\n' +
      '                    TRACKS_DB_TOKEN in .env, which is gitignored',
  )
}

const { db } = await openDb(url, resolve(root, 'migrations'), process.env.TRACKS_DB_TOKEN)

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
