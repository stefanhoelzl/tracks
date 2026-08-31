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

export default createApi(db, path)
