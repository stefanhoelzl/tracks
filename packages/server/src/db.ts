import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

export type Db = ReturnType<typeof drizzle>

/**
 * A connection, or an open transaction on one.
 *
 * Drizzle hands a transaction callback a different type from the database it came
 * from, so anything that must run either inside a transaction or on its own — reading
 * the registry, resolving a bbox, collecting types — is typed against what both have.
 */
export type Conn = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * One client, two destinations.
 *
 * `file:` opens the embedded libSQL — the same engine SQLite is, in the same process,
 * with no network — and an `https:` URL talks to Bunny Database over HTTP. Both are the
 * same client and the same drizzle dialect, so nothing above this line knows which it
 * has, which is the whole reason `better-sqlite3` had to go: a native addon cannot
 * follow the app to an edge runtime, and keeping two drivers would have meant two code
 * paths that could not share a line, since one is synchronous and the other is not.
 *
 * Everything is async now. That is not a stylistic change: a round trip is a real thing
 * that happens between two statements, and the type system saying so is the point.
 */
export async function openDb(
  url: string,
  migrationsFolder = resolve('migrations'),
  token?: string,
) {
  if (url.startsWith('file:'))
    mkdirSync(dirname(resolve(url.slice('file:'.length))), { recursive: true })

  const client = createClient({ url, authToken: token })
  const db = drizzle(client)

  // OFF by default in SQLite, so the trackpoints -> activities cascade would silently
  // not apply without it. Bunny's own connections enforce it; this is for the embedded
  // client, where the pragma is ours to set.
  if (url.startsWith('file:')) await client.execute('PRAGMA foreign_keys = ON')

  await migrate(db, { migrationsFolder })

  return { db, client, url, close: () => client.close() }
}

/**
 * The first row of a hand-written query, or nothing.
 *
 * Not `db.get()`, which is what this replaced. Drizzle's libsql driver maps a raw
 * `get` through `normalizeRow(rows[0])` without checking there is one, so a query
 * matching nothing throws `Cannot convert undefined or null to object` rather than
 * answering "no rows" — which turned every 404 in the app into a 500. The query
 * builder's own `.get()` is fine and still used; this is only for `sql` fragments.
 */
export async function first<T>(
  conn: Conn,
  query: Parameters<Conn['all']>[0],
): Promise<T | undefined> {
  const rows = (await conn.all(query)) as T[]
  return rows[0]
}
