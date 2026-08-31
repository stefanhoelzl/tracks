import { resolve } from 'node:path'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { toFrame } from '../lib/import.ts'
import { Archive } from './strava-zip/archive.ts'
import { materializeArchive } from './strava-zip/archive-fixture.ts'
import { parseCsvDate, readArchiveCsv } from './strava-zip/csv.ts'
import { StravaZipSource } from './strava-zip/index.ts'
import { sportTags } from './strava-zip/sport.ts'
import { parseTrackFile } from './strava-zip/track.ts'

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures/strava-archive')

let zip: Blob
let archive: Archive
beforeAll(async () => {
  zip = await materializeArchive(FIXTURES)
  archive = await Archive.open(zip)
})

describe('the export zip', () => {
  it('finds the root wherever activities.csv sits', async () => {
    // Some exports wrap everything in a single top-level folder.
    const nested = await Archive.open(await materializeArchive(FIXTURES, 'export_12345/'))
    expect(await nested.readText('activities.csv')).toContain('Aktivitäts-ID')
    expect(await nested.read('activities/1001.gpx')).not.toBeNull()
  })

  it('refuses a zip that is not a Strava export', async () => {
    const empty = new ZipWriter(new BlobWriter('application/zip'))
    await empty.add('holiday.jpg', new Uint8ArrayReader(new Uint8Array([1, 2, 3])))
    await expect(Archive.open(await empty.close())).rejects.toThrow(/no activities\.csv/)
  })

  it('reports a file the CSV names but the export does not carry', async () => {
    expect(await archive.read('activities/missing.gpx')).toBeNull()
  })
})

describe('activities.csv', () => {
  it('reads the German UTC date as UTC', () => {
    // Verified against the matching GPX <time>, which is identical and Z-suffixed.
    expect(parseCsvDate('16.10.2024, 15:57:17')?.toISOString()).toBe('2024-10-16T15:57:17.000Z')
    expect(parseCsvDate('not a date')).toBeNull()
  })

  it('skips rows with no track file', async () => {
    const rows = readArchiveCsv(await archive.readText('activities.csv'))
    expect(rows).toHaveLength(3) // the 4th is a pool swim with no file
    expect(rows.map((r) => r.externalId)).not.toContain('4255880574')
  })

  it('reads the machine-formatted SI block, not the localized duplicates', async () => {
    const rows = readArchiveCsv(await archive.readText('activities.csv'))
    const run = rows.find((r) => r.externalId === '1001')
    // Column 17 is metres (4146.2), column 6 is the localized '4,14' km.
    expect(run?.distanceM).toBe(4146.2)
    expect(run?.durationS).toBe(1846) // moving time, column 16
    expect(run?.elapsedS).toBe(2272) // wall clock, column 15
    expect(run?.elevationGainM).toBe(50.4)
  })

  it('links an activity to a file whose name is a different number', async () => {
    const rows = readArchiveCsv(await archive.readText('activities.csv'))
    const ride = rows.find((r) => r.externalId === '3752382383')
    expect(ride?.filename).toBe('activities/9999.gpx.gz')
  })
})

describe('track files', () => {
  const parse = async (name: string) => parseTrackFile(name, (await archive.read(name))!)

  it('parses a gzipped TCX despite whitespace before the prolog', async () => {
    const track = await parse('activities/1002.tcx.gz')
    expect(track.points).toHaveLength(5) // the 6th sample has Time but no Position
    expect(track.sportRaw).toBe('Run')
    expect(track.points[0]?.altitudeM).toBe(520)
    expect(track.points[0]?.recordedAt).toBe(Math.floor(Date.parse('2020-07-02T16:46:31Z') / 1000))
  })

  it('parses a plain GPX with its type and name', async () => {
    const track = await parse('activities/1001.gpx')
    expect(track.points).toHaveLength(6)
    expect(track.sportRaw).toBe('running')
    expect(track.title).toBe('Evening Run')
  })

  it('reports no sport for a third-party GPX with no <type>', async () => {
    const track = await parse('activities/9999.gpx.gz')
    expect(track.sportRaw).toBeNull()
    expect(track.title).toBe('Almenrunde')
  })

  it('rejects a file that is not XML at all', async () => {
    const junk = new TextEncoder().encode('this is not xml')
    await expect(parseTrackFile('activities/broken.gpx', junk)).rejects.toThrow(/parseable XML/)
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

describe('StravaZipSource', () => {
  const source = () => new StravaZipSource(archive)

  it('lists every activity that has a track file', async () => {
    const listed = await collect(source().listActivities())
    expect(listed.map((a) => a.externalId)).toEqual(['1001', '1002', '3752382383'])
  })

  it('tags the sport where the file says one, and nothing where it does not', async () => {
    const s = source()
    expect((await s.fetchTrack('1001'))?.tags).toEqual(['sport:run'])
    // No <type> in the file, so nothing is derived and a manual tag would survive.
    expect((await s.fetchTrack('3752382383'))?.tags).toEqual([])
  })

  it('prefers the track file title over the service title', async () => {
    // Strava's CSV calls it 'Fahrt am Morgen'.
    expect((await source().fetchTrack('3752382383'))?.title).toBe('Almenrunde')
  })
})

describe('the frame it puts on the wire', () => {
  it('encodes geometry, and times as offsets rather than epochs', async () => {
    const s = new StravaZipSource(archive)
    const [activity] = await collect(s.listActivities())
    const track = await s.fetchTrack(activity!.externalId)
    const frame = toFrame('strava', activity!, track!)

    expect(frame.geometry.length).toBeGreaterThan(0)
    expect(frame.altitudes).toHaveLength(track!.points.length)
    // Times are seconds since startedAt, not ten-digit epochs.
    expect(frame.times?.[0]).toBe(0)
    expect(Math.max(...frame.times!.map((t) => t ?? 0))).toBeLessThan(10_000)
    // `source:` is the server's to derive, from the frame's own source field.
    expect(frame.tags).not.toContain('source:strava')
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}
