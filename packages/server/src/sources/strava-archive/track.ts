import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { XMLParser } from 'fast-xml-parser'
import type { TrackPoint } from '../../source.ts'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // Keep ids and coordinates as strings; we convert explicitly where we mean to.
  parseTagValue: false,
  parseAttributeValue: false,
})

export interface ParsedTrack {
  points: TrackPoint[]
  /** GPX `<type>` or TCX `Sport`. Null when the file does not say. */
  sportRaw: string | null
  /** The file's own name for the activity, which may beat the service's title. */
  title: string | null
}

/** Always an array, whether the parser produced one, none, or a bare object. */
const many = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value]

const epoch = (raw: unknown): number | null => {
  if (typeof raw !== 'string') return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : Math.round(ms / 1000)
}

const numOrNull = (raw: unknown): number | null => {
  if (raw === undefined || raw === null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

export async function readTrackFile(path: string): Promise<ParsedTrack> {
  const raw = await readFile(path)
  const bytes = path.endsWith('.gz') ? gunzipSync(raw) : raw
  // Strava's TCX files start with whitespace before `<?xml`, which is strictly
  // malformed — an untrimmed prolog makes most XML parsers reject the document.
  const text = bytes.toString('utf8').trimStart()

  const isTcx = /\.tcx(\.gz)?$/i.test(path) || text.includes('TrainingCenterDatabase')
  return isTcx ? parseTcx(text) : parseGpx(text)
}

function parseGpx(text: string): ParsedTrack {
  const doc = parser.parse(text)
  const trk = many(doc?.gpx?.trk)[0]

  const points: TrackPoint[] = []
  for (const seg of many(trk?.trkseg)) {
    for (const pt of many(seg?.trkpt)) {
      const lat = numOrNull(pt?.['@lat'])
      const lon = numOrNull(pt?.['@lon'])
      if (lat === null || lon === null) continue
      points.push({ lat, lon, altitudeM: numOrNull(pt?.ele), recordedAt: epoch(pt?.time) })
    }
  }

  return {
    points,
    // Absent on third-party uploads (Garmin Desktop App writes no <type>).
    sportRaw: typeof trk?.type === 'string' ? trk.type : null,
    title: typeof trk?.name === 'string' ? trk.name : null,
  }
}

function parseTcx(text: string): ParsedTrack {
  const doc = parser.parse(text)
  const activity = many(doc?.TrainingCenterDatabase?.Activities?.Activity)[0]

  const points: TrackPoint[] = []
  for (const lap of many(activity?.Lap)) {
    for (const track of many(lap?.Track)) {
      for (const pt of many(track?.Trackpoint)) {
        const lat = numOrNull(pt?.Position?.LatitudeDegrees)
        const lon = numOrNull(pt?.Position?.LongitudeDegrees)
        if (lat === null || lon === null) continue // Pauses have a Time but no Position.
        points.push({
          lat,
          lon,
          altitudeM: numOrNull(pt?.AltitudeMeters),
          recordedAt: epoch(pt?.Time),
        })
      }
    }
  }

  const sport = activity?.['@Sport']
  return {
    points,
    sportRaw: typeof sport === 'string' ? sport : null,
    title: typeof activity?.Notes === 'string' ? activity.Notes : null,
  }
}
