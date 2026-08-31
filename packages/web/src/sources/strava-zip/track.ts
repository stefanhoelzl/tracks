import type { TrackPoint } from '../source.ts'
import { gunzip } from './gzip.ts'

/**
 * GPX and TCX, parsed with the browser's own XML parser.
 *
 * `DOMParser` replaces fast-xml-parser here, and `DecompressionStream` replaces
 * node:zlib — both are platform APIs, so moving the archive reader into the browser
 * cost one dependency (the zip reader) rather than three.
 *
 * Element lookups go through `getElementsByTagNameNS('*', …)` because both formats
 * declare a default namespace, and matching on local name means a document that
 * declares a different one still parses.
 */

export interface ParsedTrack {
  points: TrackPoint[]
  /** GPX `<type>` or TCX `Sport`. Null when the file does not say. */
  sportRaw: string | null
  /** The file's own name for the activity, which may beat the service's title. */
  title: string | null
}

const tags = (scope: Element | Document, name: string): Element[] => [
  ...scope.getElementsByTagNameNS('*', name),
]

/** The first descendant with this local name, or null. */
const tag = (scope: Element | Document, name: string): Element | null =>
  scope.getElementsByTagNameNS('*', name)[0] ?? null

const text = (element: Element | null): string | null => {
  const value = element?.textContent?.trim()
  return value ? value : null
}

const numOrNull = (raw: string | null | undefined): number | null => {
  if (raw === undefined || raw === null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const epoch = (raw: string | null): number | null => {
  if (raw === null) return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : Math.round(ms / 1000)
}

export async function parseTrackFile(name: string, raw: Uint8Array): Promise<ParsedTrack> {
  const bytes = name.endsWith('.gz') ? await gunzip(raw) : raw
  // Strava's TCX files start with whitespace before `<?xml`, which is strictly
  // malformed — an untrimmed prolog makes an XML parser reject the document.
  const source = new TextDecoder().decode(bytes).trimStart()

  const doc = new DOMParser().parseFromString(source, 'application/xml')
  // DOMParser reports a parse failure as a document rather than by throwing.
  const failure = doc.getElementsByTagName('parsererror')[0]
  if (failure) throw new Error(`${name} is not parseable XML`)

  const isTcx = /\.tcx(\.gz)?$/i.test(name) || source.includes('TrainingCenterDatabase')
  return isTcx ? parseTcx(doc) : parseGpx(doc)
}

function parseGpx(doc: Document): ParsedTrack {
  const trk = tag(doc, 'trk')

  const points: TrackPoint[] = []
  for (const pt of trk ? tags(trk, 'trkpt') : []) {
    const lat = numOrNull(pt.getAttribute('lat'))
    const lon = numOrNull(pt.getAttribute('lon'))
    if (lat === null || lon === null) continue

    points.push({
      lat,
      lon,
      altitudeM: numOrNull(text(directChild(pt, 'ele'))),
      recordedAt: epoch(text(directChild(pt, 'time'))),
    })
  }

  return {
    points,
    // Absent on third-party uploads (Garmin Desktop App writes no <type>).
    sportRaw: trk ? text(directChild(trk, 'type')) : null,
    title: trk ? text(directChild(trk, 'name')) : null,
  }
}

function parseTcx(doc: Document): ParsedTrack {
  const activity = tag(doc, 'Activity')

  const points: TrackPoint[] = []
  for (const pt of activity ? tags(activity, 'Trackpoint') : []) {
    const position = tag(pt, 'Position')
    const lat = numOrNull(text(position && tag(position, 'LatitudeDegrees')))
    const lon = numOrNull(text(position && tag(position, 'LongitudeDegrees')))
    if (lat === null || lon === null) continue // Pauses have a Time but no Position.

    points.push({
      lat,
      lon,
      altitudeM: numOrNull(text(directChild(pt, 'AltitudeMeters'))),
      recordedAt: epoch(text(directChild(pt, 'Time'))),
    })
  }

  return {
    points,
    sportRaw: activity?.getAttribute('Sport') ?? null,
    title: activity ? text(directChild(activity, 'Notes')) : null,
  }
}

/**
 * A direct child by local name.
 *
 * `<trk><name>` and `<trkpt><name>` are both `name`, so a descendant search would let
 * a waypoint's name become the track's. The same applies to a TCX `Time`, which
 * appears on the lap as well as the trackpoint.
 */
function directChild(parent: Element, name: string): Element | null {
  for (const child of parent.children) {
    if (child.localName === name) return child
  }
  return null
}
