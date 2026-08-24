import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { activities, trackpoints } from '@tracks/core'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { materializeArchive } from './archive-fixture.ts'
import { openDb } from './db.ts'
import { importSource } from './import.ts'
import { parseCsvDate, readArchiveCsv } from './sources/strava-archive/csv.ts'
import { StravaArchiveSource } from './sources/strava-archive/index.ts'
import { sportTags } from './sources/strava-archive/sport.ts'
import { readTrackFile } from './sources/strava-archive/track.ts'

const FIXTURES = resolve(import.meta.dirname, '../../../fixtures/strava-archive')
const MIGRATIONS = resolve(import.meta.dirname, '../../../migrations')

// Fixtures are committed as plain text; the .gz variants the CSV references are
// produced here so the gzip path is still exercised.
let ARCHIVE: string
beforeAll(() => {
  ARCHIVE = materializeArchive(FIXTURES)
})
afterAll(() => {
  rmSync(ARCHIVE, { recursive: true, force: true })
})

describe('activities.csv', () => {
  it('reads the German UTC date as UTC', () => {
    // Verified against the matching GPX <time>, which is identical and Z-suffixed.
    expect(parseCsvDate('16.10.2024, 15:57:17')?.toISOString()).toBe('2024-10-16T15:57:17.000Z')
    expect(parseCsvDate('not a date')).toBeNull()
  })

  it('skips rows with no track file', async () => {
    const rows = await readArchiveCsv(join(ARCHIVE, 'activities.csv'))
    expect(rows).toHaveLength(3) // the 4th is a pool swim with no file
    expect(rows.map((r) => r.externalId)).not.toContain('4255880574')
  })

  it('reads the machine-formatted SI block, not the localized duplicates', async () => {
    const rows = await readArchiveCsv(join(ARCHIVE, 'activities.csv'))
    const run = rows.find((r) => r.externalId === '1001')
    // Column 17 is metres (4146.2), column 6 is the localized '4,14' km.
    expect(run?.distanceM).toBe(4146.2)
    expect(run?.durationS).toBe(1846) // moving time, column 16
    expect(run?.elapsedS).toBe(2272) // wall clock, column 15
    expect(run?.elevationGainM).toBe(50.4)
  })

  it('links an activity to a file whose name is a different number', async () => {
    const rows = await readArchiveCsv(join(ARCHIVE, 'activities.csv'))
    const ride = rows.find((r) => r.externalId === '3752382383')
    expect(ride?.filename).toBe('activities/9999.gpx.gz')
  })
})

describe('track files', () => {
  it('parses a gzipped TCX despite whitespace before the prolog', async () => {
    const track = await readTrackFile(join(ARCHIVE, 'activities/1002.tcx.gz'))
    expect(track.points).toHaveLength(5) // the 6th sample has Time but no Position
    expect(track.sportRaw).toBe('Run')
    expect(track.points[0]?.altitudeM).toBe(520)
    expect(track.points[0]?.recordedAt).toBe(Math.floor(Date.parse('2020-07-02T16:46:31Z') / 1000))
  })

  it('parses a plain GPX with its type and name', async () => {
    const track = await readTrackFile(join(ARCHIVE, 'activities/1001.gpx'))
    expect(track.points).toHaveLength(6)
    expect(track.sportRaw).toBe('running')
    expect(track.title).toBe('Evening Run')
  })

  it('reports no sport for a third-party GPX with no <type>', async () => {
    const track = await readTrackFile(join(ARCHIVE, 'activities/9999.gpx.gz'))
    expect(track.sportRaw).toBeNull()
    expect(track.title).toBe('Almenrunde')
  })
})

describe("the archive's own sport vocabulary", () => {
  it('maps what GPX <type> and TCX Sport actually say', () => {
    expect(sportTags('running')).toEqual(['sport:run']) // GPX <type>
    expect(sportTags('Run')).toEqual(['sport:run']) // TCX Sport
    expect(sportTags('cycling')).toEqual(['sport:bike'])
    expect(sportTags('Mountain Bike Ride')).toEqual(['sport:bike'])
  })

  it('derives nothing from silence, and nothing from a word it does not know', () => {
    // Both leave existing tags alone, and both read as 'not set' in the UI.
    expect(sportTags(null)).toEqual([])
    expect(sportTags('')).toEqual([])
    expect(sportTags('curling')).toEqual([])
  })
})

describe('import', () => {
  let dir: string
  let handle: ReturnType<typeof openDb>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracks-test-'))
    handle = openDb(join(dir, 'test.db'), MIGRATIONS)
  })

  afterEach(() => {
    handle.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const run = () => importSource(handle.db, new StravaArchiveSource(ARCHIVE))

  it('imports every activity that has a track', async () => {
    const result = await run()
    expect(result).toMatchObject({ seen: 3, imported: 3, failed: [] })

    const rows = handle.db.select().from(activities).all()
    expect(rows).toHaveLength(3)
    expect(handle.db.select({ n: sql<number>`count(*)` }).from(trackpoints).get()?.n).toBe(18)
  })

  it('is idempotent', async () => {
    await run()
    const second = await run()
    expect(second).toMatchObject({ imported: 0, unchanged: 3 })
    expect(handle.db.select({ n: sql<number>`count(*)` }).from(trackpoints).get()?.n).toBe(18)
  })

  it('derives the offset from coordinates, with DST', async () => {
    await run()
    const rows = handle.db.select().from(activities).all()
    expect(rows.find((r) => r.externalId === '1001')?.utcOffset).toBe(7200) // October
    expect(rows.find((r) => r.externalId === '1002')?.utcOffset).toBe(7200) // July
  })

  it('prefers the track file title over the service title', async () => {
    await run()
    const ride = handle.db
      .select()
      .from(activities)
      .all()
      .find((r) => r.externalId === '3752382383')
    expect(ride?.title).toBe('Almenrunde') // not Strava's 'Fahrt am Morgen'
  })

  it('leaves an untyped activity unlabelled, and keeps a manual tag across re-import', async () => {
    await run()
    const id = '3752382383'
    const before = handle.db
      .select()
      .from(activities)
      .all()
      .find((r) => r.externalId === id)
    // No sport, because the file carries no <type>; source is always derived.
    expect(JSON.parse(before?.tags ?? '[]')).toEqual(['source:strava'])

    // Tag it by hand, then wipe its track so the next import re-processes it.
    handle.sqlite
      .prepare('update activities set tags = ? where external_id = ?')
      .run(JSON.stringify(['source:strava', 'sport:bike', 'trip:Alps']), id)
    handle.sqlite.prepare('delete from trackpoints where activity_id = ?').run(before?.id)

    await run()
    const after = handle.db
      .select()
      .from(activities)
      .all()
      .find((r) => r.externalId === id)
    expect(JSON.parse(after?.tags ?? '[]')).toEqual(['source:strava', 'sport:bike', 'trip:Alps'])
  })

  it('tags every activity with its source, and its sport where the file says one', async () => {
    await run()
    const rows = handle.db.select().from(activities).all()
    const tags = Object.fromEntries(rows.map((r) => [r.externalId, JSON.parse(r.tags)]))

    expect(tags['1001']).toEqual(['source:strava', 'sport:run'])
    expect(tags['1002']).toEqual(['source:strava', 'sport:run'])
    expect(tags['3752382383']).toEqual(['source:strava']) // no <type> in the file
  })

  it('re-adds an enum value a source still derives, rather than dropping the tag', async () => {
    // A source's vocabulary is a fact; the registry is a preference.
    handle.sqlite
      .prepare(`update tag_types set enum_values = '["bike"]' where name = 'sport'`)
      .run()

    const result = await run()
    expect(result.readdedValues).toEqual(['sport:run'])
    expect(result.rejectedTags.size).toBe(0)
    expect(
      handle.sqlite.prepare(`select enum_values as v from tag_types where name = 'sport'`).get(),
    ).toEqual({ v: '["bike","run"]' })
  })

  it('drops a derived tag whose type is unknown, without failing the import', async () => {
    handle.sqlite.prepare(`delete from tag_types where name = 'source'`).run()

    const result = await run()
    expect(result).toMatchObject({ imported: 3, failed: [] })
    expect(result.rejectedTags.get('source:strava')).toBe(3)

    const rows = handle.db.select().from(activities).all()
    expect(rows.flatMap((r) => JSON.parse(r.tags))).not.toContain('source:strava')
  })

  it('stores a decodable polyline', async () => {
    await run()
    const row = handle.db
      .select()
      .from(activities)
      .all()
      .find((r) => r.externalId === '1001')
    expect(row?.polyline).toBeTruthy()
    expect(row?.polyline?.length).toBeGreaterThan(0)
  })
})
