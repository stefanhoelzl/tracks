import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

  it('prefixes bare sport tags and splices in the source, sorted', () => {
    const path = join(dir, 'test.db')

    const before = openDb(path, initialOnly(dir))
    const insert = before.sqlite.prepare(
      `insert into activities (source, external_id, started_at, utc_offset, tags)
       values (?, ?, '2024-10-16T15:57:17Z', 7200, ?)`,
    )
    insert.run('komoot', '1', JSON.stringify(['bike']))
    insert.run('strava', '2', JSON.stringify(['run']))
    // The untyped Garmin uploads: no sport at all, and none invented for them.
    insert.run('strava', '3', JSON.stringify([]))
    before.close()

    const after = openDb(path, MIGRATIONS)
    try {
      const rows = after.sqlite
        .prepare('select external_id, tags from activities order by external_id')
        .all() as Array<{ external_id: string; tags: string }>

      expect(rows.map((r) => JSON.parse(r.tags))).toEqual([
        ['source:komoot', 'sport:bike'],
        ['source:strava', 'sport:run'],
        ['source:strava'],
      ])
    } finally {
      after.close()
    }
  })

  it('seeds the three types that exist today', () => {
    const handle = openDb(join(dir, 'seed.db'), MIGRATIONS)
    try {
      const rows = handle.sqlite
        .prepare('select name, enum_values, single_valued from tag_types order by sort')
        .all()

      expect(rows).toEqual([
        { name: 'sport', enum_values: '["bike","hike","run"]', single_valued: 1 },
        { name: 'trip', enum_values: null, single_valued: 1 },
        { name: 'source', enum_values: null, single_valued: 1 },
      ])
    } finally {
      handle.close()
    }
  })
})
