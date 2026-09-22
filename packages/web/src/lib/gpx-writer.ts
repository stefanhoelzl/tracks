import { type ActivityDetail, parseTag } from '@tracks/core'

/**
 * Activities out as GPX 1.1: one `<trk>` per activity, in one file.
 *
 * The other half of `gpx-parser.ts`, and tested against it — a file this writes is read
 * back by the importer as the same points, heights, times, name and sport.
 *
 * Written in pieces rather than as one string, because an export of a whole account is
 * a million points: the caller hands the head, each track and the tail to a `Blob`, and
 * no single string ever holds all of it. A track is built as soon as its detail arrives,
 * so the decoded arrays behind it can go.
 *
 * What goes in is what a tool re-importing the file needs, and nothing else: the title,
 * the sport, and per point the position, the height and the time. Tags beyond the sport
 * stay behind — no other tool reads them, and the importer does not either.
 */

export const GPX_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<gpx version="1.1" creator="Tracks" xmlns="http://www.topografix.com/GPX/1/1">\n'

export const GPX_TAIL = '</gpx>\n'

/** The whole document, for when the tracks already fit in memory. */
export function writeGpx(details: Iterable<ActivityDetail>): string {
  const tracks = [...details].map(gpxTrack).filter((track) => track !== null)
  return GPX_HEAD + tracks.join('') + GPX_TAIL
}

/**
 * One activity's `<trk>`, or null when it has no track to write.
 *
 * An activity without times is still written, without `<time>`: a valid GPX that other
 * tools read as a route. A point missing its height or its time omits just that element,
 * as the recording did.
 */
export function gpxTrack({ activity, track }: ActivityDetail): string | null {
  if (track.coordinates.length === 0) return null

  const startMs = Date.parse(activity.startedAt)
  const sport = activity.tags.map(parseTag).find((tag) => tag?.type === 'sport')?.value

  const lines = ['  <trk>\n']
  if (activity.title) lines.push(`    <name>${xmlText(activity.title)}</name>\n`)
  // As stored, not translated to another service's word: Tracks' own importer maps
  // `bike`, `hike` and `run` straight back.
  if (sport) lines.push(`    <type>${xmlText(sport)}</type>\n`)
  lines.push('    <trkseg>\n')

  track.coordinates.forEach(([lon, lat], index) => {
    const altitude = track.altitudeM[index] ?? null
    const seconds = track.secondsFromStart[index] ?? null
    const ele = altitude === null ? '' : `<ele>${decimal(altitude, 1)}</ele>`
    const time = seconds === null ? '' : `<time>${instant(startMs + seconds * 1000)}</time>`
    lines.push(
      `      <trkpt lat="${decimal(lat, 6)}" lon="${decimal(lon, 6)}">${ele}${time}</trkpt>\n`,
    )
  })

  lines.push('    </trkseg>\n', '  </trk>\n')
  return lines.join('')
}

/**
 * At most `digits` decimals, trailing zeros dropped. Six for coordinates is exactly the
 * precision they are stored at, so the round trip is lossless; one for heights is the
 * decimetre they are stored at.
 */
function decimal(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)))
}

/** UTC, to the second — `2026-09-21T06:14:03Z`, the shape every exporter writes. */
function instant(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function xmlText(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
