/**
 * The scalar tracks that ride alongside the geometry: altitude and time.
 *
 * A track's coordinates travel as an encoded polyline because point objects cost 2.65MB
 * against 0.30MB. Its altitudes travelled as a JSON array of numbers anyway, which for
 * 1.02M points is 6.41MB against 1.01MB encoded — the same argument, never applied to
 * the other half of the payload. This is that codec, in one dimension.
 *
 * It is the polyline codec's own scheme: zig-zag the delta from the previous value, then
 * emit it five bits at a time, low chunk first, each chunk offset by 63 and all but the
 * last carrying a continuation bit. Same alphabet, same shape, so anything that already
 * reads a polyline is already most of the way to reading these.
 *
 * Two departures. There is one dimension rather than two, because a pair here would spend
 * a byte per point on a constant. And a value may be absent: a dropout leaves a gap in the
 * altitude a device recorded, and the profile draws that gap rather than a line through it,
 * so `null` has to survive the round trip. Values are therefore doubled before encoding
 * and an odd chunk means "absent" — which costs one bit of headroom per value, measured at
 * 1.5% over the whole corpus, because the deltas are small enough that the extra bit
 * rarely reaches into another character.
 *
 * Integers only. The callers scale first — altitude to decimetres, time to seconds from
 * the activity's start — because a fixed point chosen per field is smaller and clearer
 * than a float encoding that would carry the same precision everywhere.
 */

/**
 * What the full-resolution geometry is encoded at, everywhere.
 *
 * Six decimal places is what the sources report and what `trackpoints` held, so the round
 * trip is exact to within half a unit in the last place — 5.6cm, against a receiver with
 * 1-3m of error. It lives here rather than beside each user because there are now three:
 * the importer that writes the column, the route that sends it, and the browser that
 * decodes it. A comment saying "must match what the route encodes with" was the previous
 * arrangement.
 */
export const TRACK_PRECISION = 6

/** What one absent value encodes to. Any odd chunk means absent; 1 is the shortest. */
const ABSENT = 1

/**
 * Signed integers, delta-coded. `null` is preserved and does not disturb the running
 * value, so a gap costs one character and the values on either side of it stay adjacent.
 */
export function encodeScalars(values: ReadonlyArray<number | null>): string {
  let out = ''
  let previous = 0

  for (const value of values) {
    if (value === null) {
      out += chunk(ABSENT)
      continue
    }
    const delta = value - previous
    previous = value
    // Zig-zag, then double: the low bit is now the absent flag rather than the sign.
    out += chunk((delta < 0 ? ~(delta << 1) : delta << 1) * 2)
  }

  return out
}

/** The inverse. Throws on a truncated stream rather than returning a short array. */
export function decodeScalars(encoded: string): Array<number | null> {
  const values: Array<number | null> = []
  let previous = 0
  let index = 0

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number

    do {
      if (index >= encoded.length) throw new Error('scalar stream ends mid-value')
      byte = encoded.charCodeAt(index++) - 63
      if (byte < 0) throw new Error('scalar stream holds a character outside the alphabet')
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)

    if ((result & 1) === ABSENT) {
      values.push(null)
      continue
    }

    const zigzag = result >> 1
    previous += zigzag & 1 ? ~(zigzag >> 1) : zigzag >> 1
    values.push(previous)
  }

  return values
}

function chunk(value: number): string {
  let rest = value
  let out = ''
  while (rest >= 0x20) {
    out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63)
    rest >>= 5
  }
  return out + String.fromCharCode(rest + 63)
}

/** Altitude is stored and sent in decimetres: 0.1 m is what the sources themselves report. */
export const ALTITUDE_SCALE = 10

/** Metres, from decimetres, with `null` preserved. */
export function altitudesFromScalars(values: ReadonlyArray<number | null>): Array<number | null> {
  return values.map((value) => (value === null ? null : value / ALTITUDE_SCALE))
}

/** Decimetres, from metres, with `null` preserved. */
export function altitudesToScalars(values: ReadonlyArray<number | null>): Array<number | null> {
  return values.map((value) => (value === null ? null : Math.round(value * ALTITUDE_SCALE)))
}
