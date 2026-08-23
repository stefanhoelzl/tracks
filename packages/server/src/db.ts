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

  return { db, sqlite, close: () => sqlite.close() }
}
