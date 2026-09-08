/**
 * Copies part of the deployed database into a local one.
 *
 *     pnpm db:pull                    # everything started before a year ago
 *     pnpm db:pull --before 2025-06-01
 *
 * The middle of the three development modes. Generated data (`pnpm db:seed`) is enough
 * for most work and knows nothing about your riding; the deployed database is the real
 * thing and is a poor place to experiment with a bulk tag write. This is the compromise:
 * real tracks, real tags, real shapes, on a file you can throw away.
 *
 * A cutoff rather than a limit, and old rather than new: what makes a local copy worth
 * having is that it looks like the real archive, and what makes it worth *not* having in
 * full is everything recent. Anything after the date stays where it is.
 *
 * It is not a backup. Decision: Bunny snapshots hourly and this deliberately does not
 * compete with that — it never runs on a schedule, it copies a slice, and nothing reads
 * it but `pnpm dev:local`.
 */
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@libsql/client'
import { openDb } from '@tracks/server/db.ts'
import { sql } from 'drizzle-orm'

const url = process.env.TRACKS_DB_URL
if (!url || url.startsWith('file:')) {
  throw new Error('TRACKS_DB_URL must point at the deployed database, not a file')
}

const flag = process.argv.indexOf('--before')
const cutoff =
  flag === -1
    ? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : process.argv[flag + 1]
if (!cutoff) throw new Error('--before needs a date, as YYYY-MM-DD')

const remote = createClient({ url, authToken: process.env.TRACKS_DB_TOKEN })

const path = resolve(import.meta.dirname, '../../data/dev.db')
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(path + suffix)) rmSync(path + suffix)
}
const local = await openDb(`file:${path}`, resolve(import.meta.dirname, '../../migrations'))

// Everything lands on the account migration 0004 seeded here, whatever it is called
// there: a local copy has no business carrying somebody's address around.
const [user] = await local.db.all<{ id: number; email: string }>(sql`SELECT id, email FROM users`)
const userId = user!.id

const rows = async (statement: string, args: unknown[] = []) =>
  (await remote.execute({ sql: statement, args: args as never })).rows

const activities = await rows('SELECT * FROM activities WHERE started_at < ? ORDER BY started_at', [
  `${cutoff}T00:00:00.000Z`,
])
console.log(`${activities.length} activities started before ${cutoff}`)
if (activities.length === 0) console.log('nothing to copy — try a later --before')

const insert = async (table: string, columns: string[], values: unknown[][]) => {
  for (let i = 0; i < values.length; i += 400) {
    const chunk = values.slice(i, i + 400)
    await local.client.execute({
      sql: `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES ${chunk
        .map((row) => `(${row.map(() => '?').join(',')})`)
        .join(',')}`,
      args: chunk.flat() as never,
    })
  }
}

const types = await rows('SELECT name, label, single_valued, sort FROM tag_types')
await insert(
  'tag_types',
  ['user_id', 'name', 'label', 'single_valued', 'sort'],
  types.map((t) => [userId, t.name, t.label, t.single_valued, t.sort]),
)

const COLUMNS = [
  'id',
  'source',
  'external_id',
  'title',
  'started_at',
  'utc_offset',
  'distance_m',
  'duration_s',
  'elapsed_s',
  'elevation_gain_m',
  'polyline',
  'tags',
  'min_lat',
  'max_lat',
  'min_lon',
  'max_lon',
  // The track itself, three columns on the row. It used to be a second pass — one query
  // per activity against a row-per-point table, a million rows over the network for a
  // local copy — and it is now three more values in the row already being copied.
  'track_geometry',
  'track_altitudes',
  'track_times',
]
await insert(
  'activities',
  ['user_id', ...COLUMNS],
  activities.map((a) => [userId, ...COLUMNS.map((c) => a[c])]),
)

console.log(`\ndata/dev.db: ${activities.length} activities for ${user!.email}`)
console.log('`pnpm dev:local` signs in as that account by itself — password: password')
console.log('\n  pnpm dev:local')

remote.close()
local.close()
