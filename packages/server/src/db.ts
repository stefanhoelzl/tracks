import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export type Db = ReturnType<typeof openDb>['db']

/**
 * A connection, or an open transaction on one.
 *
 * Drizzle hands a transaction callback a different type from the database it came
 * from, so anything that must run either inside a transaction or on its own — reading
 * the registry, resolving a bbox, collecting types — is typed against what both have.
 */
export type Conn = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

export function openDb(path: string, migrationsFolder = resolve('migrations')) {
  mkdirSync(dirname(resolve(path)), { recursive: true })

  const sqlite = new Database(path)
  // OFF by default in SQLite, so the trackpoints -> activities cascade would
  // silently not apply without this.
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  // This connection writes too, now that tags are editable, and an import holds the
  // write lock on its own connection for the length of its run. Waiting is the right
  // answer to that: a tag write during an import is a few seconds late, not refused.
  sqlite.pragma('busy_timeout = 5000')

  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  return { db, sqlite, path, close: () => sqlite.close() }
}
