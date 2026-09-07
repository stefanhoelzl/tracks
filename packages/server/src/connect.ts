import type { Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'

/**
 * The database, given a client someone else made.
 *
 * The split matters: this file reaches for no filesystem and picks no build of the
 * libSQL client, so it is the half that can be bundled into an edge script. `db.ts`
 * is the other half — `createClient` from the Node build, a migrations folder to read,
 * a directory to create — and none of that exists in an isolate.
 *
 * It also means the edge never migrates. Schema is applied by the Bunny CLI in CI,
 * before the script that needs it is deployed; a script that migrated on boot would be
 * every cold isolate racing the same statements against a 500ms startup budget.
 */
export type Db = ReturnType<typeof drizzle>

/**
 * A connection, or an open transaction on one.
 *
 * Drizzle hands a transaction callback a different type from the database it came
 * from, so anything that must run either inside a transaction or on its own — reading
 * the registry, resolving a bbox, collecting types — is typed against what both have.
 */
export type Conn = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export function connect(client: Client): Db {
  return drizzle(client)
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
