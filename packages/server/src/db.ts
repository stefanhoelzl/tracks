import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export type Db = ReturnType<typeof openDb>['db']

export function openDb(path: string, migrationsFolder = resolve('migrations')) {
  mkdirSync(dirname(resolve(path)), { recursive: true })

  const sqlite = new Database(path)
  // OFF by default in SQLite, so the trackpoints -> activities cascade would
  // silently not apply without this.
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')

  const db = drizzle(sqlite)
  migrate(db, { migrationsFolder })

  return { db, sqlite, path, close: () => sqlite.close() }
}

export type Writer = ReturnType<typeof openWriter>

/**
 * A second connection to the same file, for the length of one import.
 *
 * An import holds a single transaction from its first activity to its last, so that
 * cancelling it can be a `ROLLBACK` rather than an undo log. That transaction cannot
 * live on the connection the API reads through: every uncommitted row would be visible
 * to the map and the list, and the rollback would then yank them back out.
 *
 * A second connection is what makes the isolation real. The database is in WAL mode, so
 * the reader keeps serving the snapshot from before the import for as long as the writer
 * is uncommitted, and sees the whole import appear at once when it commits.
 *
 * No migration runs here — the reader already brought the schema up to date, and a
 * second migrator racing the first is a way to corrupt both.
 */
export function openWriter(path: string) {
  const sqlite = new Database(path)
  sqlite.pragma('foreign_keys = ON')
  // Two connections now want the same file. Only one may write at a time, and this is
  // how long the loser waits before deciding the winner is stuck rather than slow.
  sqlite.pragma('busy_timeout = 5000')

  return { db: drizzle(sqlite), sqlite, close: () => sqlite.close() }
}
