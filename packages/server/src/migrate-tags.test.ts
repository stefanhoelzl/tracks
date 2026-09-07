import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb } from './db.ts'

const MIGRATIONS = resolve(import.meta.dirname, '../../../migrations')

/**
 * A migrations folder holding only 0000, so a database can be built in the shape it
 * had before types existed — bare tags, no registry — and then migrated for real.
 */
function initialOnly(dir: string): string {
  const folder = join(dir, 'migrations-0000')
  mkdirSync(join(folder, 'meta'), { recursive: true })
  cpSync(join(MIGRATIONS, '0000_init.sql'), join(folder, '0000_init.sql'))

  // Keeping the real entry, timestamp included: drizzle decides what to apply by
  // comparing `when` against what it has already recorded, so a synthetic one would
  // make the second open replay 0000 on top of itself.
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
  writeFileSync(
    join(folder, 'meta/_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 1) }),
  )
  return folder
}

describe('the typed-tags migration', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracks-migrate-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('prefixes bare sport tags and splices in the source, sorted', async () => {
    const url = `file:${join(dir, 'test.db')}`

    const before = await openDb(url, initialOnly(dir))
    const insert = (source: string, id: string, tags: string[]) =>
      before.client.execute({
        sql: `insert into activities (source, external_id, started_at, utc_offset, tags)
              values (?, ?, '2024-10-16T15:57:17Z', 7200, ?)`,
        args: [source, id, JSON.stringify(tags)],
      })
    await insert('komoot', '1', ['bike'])
    await insert('strava', '2', ['run'])
    // The untyped Garmin uploads: no sport at all, and none invented for them.
    await insert('strava', '3', [])
    before.close()

    const after = await openDb(url, MIGRATIONS)
    try {
      const rows = (await after.db.all(
        sql`select external_id, tags from activities order by external_id`,
      )) as Array<{ external_id: string; tags: string }>

      expect(rows.map((r) => JSON.parse(r.tags))).toEqual([
        ['source:komoot', 'sport:bike'],
        ['source:strava', 'sport:run'],
        ['source:strava'],
      ])

      // `trip` was seeded with the others and nothing ever carried one, so the rule
      // that a type lives only as long as its last tag takes it away here.
      expect(await after.db.all(sql`select name from tag_types order by sort`)).toEqual([
        { name: 'sport' },
        { name: 'source' },
      ])
    } finally {
      after.close()
    }
  })

  it('leaves a fresh database with no types at all', async () => {
    const handle = await openDb(`file:${join(dir, 'seed.db')}`, MIGRATIONS)
    try {
      // Seeding three types into an empty database would put three facets in the
      // sidebar that nothing has ever used. `sport` and `source` come back from their
      // seeds in code the first time an import derives one; the rest you name yourself.
      expect(await handle.db.get(sql`select count(*) as n from tag_types`)).toEqual({ n: 0 })
    } finally {
      handle.close()
    }
  })
})
