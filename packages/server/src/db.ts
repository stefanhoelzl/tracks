import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { connect } from './connect.ts'

/**
 * A database on this machine, schema included.
 *
 * Node only — it creates directories and reads a migrations folder, neither of which an
 * isolate has. The edge uses `connect` directly against a client of its own, and gets
 * its schema from the Bunny CLI in CI rather than on boot.
 *
 * `file:` opens the embedded libSQL — the same engine SQLite is, in the same process,
 * with no network — and an `https:` URL talks to Bunny Database over HTTP. Both are the
 * same client and the same drizzle dialect, so nothing above this line knows which it
 * has, which is the whole reason `better-sqlite3` had to go: a native addon cannot
 * follow the app to an edge runtime, and keeping two drivers would have meant two code
 * paths that could not share a line, since one is synchronous and the other is not.
 */
export async function openDb(
  url: string,
  migrationsFolder = resolve('migrations'),
  token?: string,
) {
  if (url.startsWith('file:')) {
    mkdirSync(dirname(resolve(url.slice('file:'.length))), { recursive: true })
  }

  const client = createClient({ url, authToken: token })
  const db = connect(client)

  // OFF by default in SQLite, so the trackpoints -> activities cascade would silently
  // not apply without it. Bunny's own connections enforce it; this is for the embedded
  // client, where the pragma is ours to set.
  if (url.startsWith('file:')) await client.execute('PRAGMA foreign_keys = ON')

  await migrate(db, { migrationsFolder })

  return { db, client, url, close: () => client.close() }
}
