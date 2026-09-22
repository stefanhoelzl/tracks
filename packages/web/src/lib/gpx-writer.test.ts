import type { ActivityDetail } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { parseTrackBytes } from './gpx-parser.ts'
import { GPX_HEAD, GPX_TAIL, gpxTrack, writeGpx } from './gpx-writer.ts'

/**
 * Read back by the parser the importer uses, so "the file is right" means "Tracks would
 * import it as the same ride" rather than "it matches a string somebody typed".
 */
const read = (xml: string) => parseTrackBytes('export.gpx', new TextEncoder().encode(xml))

function detail(
  overrides: Partial<ActivityDetail['activity']> = {},
  track?: Partial<ActivityDetail['track']>,
): ActivityDetail {
  return {
    activity: {
      id: 7,
      source: 'strava',
      title: 'Isar loop',
      startedAt: '2026-09-21T06:14:00Z',
      utcOffset: 7200,
      localDate: '2026-09-21',
      distanceM: 87_400,
      durationS: 13_260,
      elapsedS: 14_700,
      elevationGainM: 612,
      speedMs: 6.6,
      tags: ['source:strava', 'sport:bike', 'trip:Alps 2026'],
      ...overrides,
    },
    track: {
      coordinates: [
        [11.576124, 48.137154],
        [11.576981, 48.137702],
        [11.578003, 48.138251],
      ],
      altitudeM: [519.4, null, 521],
      secondsFromStart: [0, 4, 9],
      ...track,
    },
  }
}

describe('writeGpx', () => {
  it('round-trips positions, heights and times through the importer’s parser', async () => {
    const file = await read(writeGpx([detail()]))

    expect(file.parts).toHaveLength(1)
    const [part] = file.parts
    expect(part?.kind).toBe('track')
    expect(part?.points).toEqual([
      { lat: 48.137154, lon: 11.576124, altitudeM: 519.4, recordedAt: 1_789_971_240 },
      // A missing height is left out of that one point, not zeroed.
      { lat: 48.137702, lon: 11.576981, altitudeM: null, recordedAt: 1_789_971_244 },
      { lat: 48.138251, lon: 11.578003, altitudeM: 521, recordedAt: 1_789_971_249 },
    ])
  })

  it('names the track by its title and types it by its sport tag, as stored', async () => {
    const [part] = (await read(writeGpx([detail()]))).parts
    expect(part?.name).toBe('Isar loop')
    expect(part?.sportRaw).toBe('bike')
  })

  it('writes one <trk> per activity, in the order given', async () => {
    const file = await read(writeGpx([detail({ title: 'First' }), detail({ title: 'Second' })]))
    expect(file.parts.map((part) => part.name)).toEqual(['First', 'Second'])
  })

  it('escapes a title that would otherwise break the XML', async () => {
    const [part] = (await read(writeGpx([detail({ title: 'Berg & Tal <3 "Runde"' })]))).parts
    expect(part?.name).toBe('Berg & Tal <3 "Runde"')
  })

  it('leaves out <name> and <type> when there is nothing to put in them', () => {
    const xml = writeGpx([detail({ title: null, tags: ['source:komoot'] })])
    expect(xml).not.toContain('<name>')
    expect(xml).not.toContain('<type>')
  })

  it('writes a track without times as positions alone', async () => {
    const xml = writeGpx([detail({}, { secondsFromStart: [null, null, null] })])
    expect(xml).not.toContain('<time>')
    const [part] = (await read(xml)).parts
    expect(part?.points.map((point) => point.recordedAt)).toEqual([null, null, null])
  })

  it('skips an activity with no track', async () => {
    const empty = detail(
      { title: 'Indoor' },
      { coordinates: [], altitudeM: [], secondsFromStart: [] },
    )
    expect(gpxTrack(empty)).toBeNull()

    const file = await read(writeGpx([empty, detail()]))
    expect(file.parts.map((part) => part.name)).toEqual(['Isar loop'])
  })

  it('is a valid, empty document when nothing has a track', async () => {
    expect(writeGpx([])).toBe(GPX_HEAD + GPX_TAIL)
    expect((await read(writeGpx([]))).parts).toEqual([])
  })
})
