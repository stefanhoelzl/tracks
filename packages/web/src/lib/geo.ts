/**
 * Measurements over a decoded track.
 *
 * All of it is derived, none of it is stored. The brief's reason for rejecting
 * self-computed metrics still holds — a segment has to be measured dynamically
 * whatever we do, so measuring the whole track the same way is one code path rather
 * than two — and these are the measurements the elevation profile needs.
 *
 * Gradient is the one addition that looks like a metric the brief turned down. It is
 * not the same thing: elevation gain was rejected because the service reports it and a
 * second, slightly different number beside the first reads as a bug. Nothing reports a
 * gradient, so there is no pair of right numbers to disagree.
 */

type Point = readonly [number, number]

const EARTH_M = 6_371_000
const RAD = Math.PI / 180

function haversine(a: Point, b: Point): number {
  const [lonA, latA] = a
  const [lonB, latB] = b

  const dLat = (latB - latA) * RAD
  const dLon = (lonB - lonA) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(latA * RAD) * Math.cos(latB * RAD) * Math.sin(dLon / 2) ** 2

  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Distance along the track at each point, in metres.
 *
 * Scaled so the last one lands exactly on the service-reported distance. Our sum and
 * Strava's differ by a few tenths of a percent — different smoothing, and they are
 * measuring the ride while we are measuring the polyline — and left alone that lands
 * an axis reading `87.1 km` directly under a tile reading `87.4`. Two right numbers
 * that look like a bug. Spreading the difference across the track keeps every readout
 * agreeing with the one number the user already knows.
 *
 * With no reported distance there is nothing to agree with, so the raw sum stands.
 */
export function cumulativeDistances(
  coordinates: readonly Point[],
  reportedM: number | null,
): number[] {
  const out = new Array<number>(coordinates.length)
  let running = 0

  for (let i = 0; i < coordinates.length; i++) {
    const previous = coordinates[i - 1]
    const current = coordinates[i]
    if (previous && current) running += haversine(previous, current)
    out[i] = running
  }

  if (reportedM === null || running <= 0) return out

  const scale = reportedM / running
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * scale
  return out
}

/**
 * The point nearest a longitude/latitude, as an index.
 *
 * A plain scan. It runs once per `mousemove` over the selected track, which at 34k
 * points is a tenth of a millisecond — an index built to avoid that would cost more
 * to keep in step than it saves. Longitude is scaled by the latitude's cosine so a
 * degree means the same distance on both axes; without it the nearest point at 47°N
 * is chosen with east–west errors weighted two-thirds too heavily.
 */
export function nearestIndex(coordinates: readonly Point[], lon: number, lat: number): number {
  const squash = Math.cos(lat * RAD)
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY

  for (let i = 0; i < coordinates.length; i++) {
    const point = coordinates[i]
    if (!point) continue
    const dx = (point[0] - lon) * squash
    const dy = point[1] - lat
    const distance = dx * dx + dy * dy
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }

  return best
}

/** Close enough anywhere for choosing which leg a click meant. */
const M_PER_DEG = 111_320

export interface PathHit {
  /** How far along, as a segment index plus the fraction across it. Monotonic. */
  position: number
  distanceM: number
}

/**
 * The closest point on a path, as a distance and a position along it.
 *
 * Perpendicular to each *segment*, not to the vertices — which `nearestIndex` above
 * does and which is right for a dense recorded track, where the nearest vertex is never
 * far from the nearest point. A plan's legs are not always dense: an unrouted leg is two
 * points that may be twenty kilometres apart, and a click in the middle of it is nowhere
 * near either end. Choosing the leg a click meant has to work for that case, because it
 * is exactly the case where the router has not answered yet.
 *
 * Longitude is squashed by the latitude's cosine so a degree means the same distance on
 * both axes, and the result is scaled to metres — near enough for comparing legs.
 */
export function nearestOnPath(coordinates: readonly Point[], lon: number, lat: number): PathHit {
  const squash = Math.cos(lat * RAD)
  const px = lon * squash
  let best: PathHit = { position: 0, distanceM: Number.POSITIVE_INFINITY }

  for (let i = 0; i + 1 < coordinates.length; i++) {
    const from = coordinates[i]
    const to = coordinates[i + 1]
    if (!from || !to) continue

    const ax = from[0] * squash
    const ay = from[1]
    const dx = to[0] * squash - ax
    const dy = to[1] - ay

    const span = dx * dx + dy * dy
    const t = span === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (lat - ay) * dy) / span))

    const offX = px - (ax + t * dx)
    const offY = lat - (ay + t * dy)
    const distanceM = Math.sqrt(offX * offX + offY * offY) * M_PER_DEG

    if (distanceM < best.distanceM) best = { position: i + t, distanceM }
  }

  return best
}

/**
 * The position of the nearest value in an ascending array.
 *
 * Binary search, because the arrays it searches are sorted by construction — this runs
 * on every pointer move, where the scan above is answering a question that has no order
 * to exploit. The profile asks it twice, in both directions: over the drawn points'
 * distances, to turn a pointer into a point, and over their track indices, to turn a
 * point the map is hovering back into one the chart drew.
 */
export function nearestInSorted(values: readonly number[], target: number): number {
  if (values.length === 0) return -1

  let low = 0
  let high = values.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (values[mid]! < target) low = mid + 1
    else high = mid
  }

  const here = values[low]!
  const before = values[low - 1]
  if (before !== undefined && Math.abs(before - target) < Math.abs(here - target)) return low - 1
  return low
}

/** The distance a gradient is measured across, centred on the point it belongs to. */
export const GRADIENT_WINDOW_M = 100

/**
 * Gradient at each point, in percent, measured across a centred window.
 *
 * Point to point is not a gradient, it is an altimeter's noise: at the ~7 m spacing a
 * ride records at, ±0.2 m of altitude error is ±3% of slope, and a profile coloured
 * from it would speckle rather than describe anything. A window in *metres* rather
 * than in points is what makes the answer the same whether the points arrived 2 m
 * apart on foot or 15 m apart down a descent.
 *
 * The window narrows rather than gives up: near a dropout, or at either end of the
 * track, it measures across the widest measured pair it can still find inside itself.
 *
 * It widens for the opposite case. A track recorded more coarsely than the window is
 * wide holds no pair at all — not because anything is missing but because that is how
 * often it was sampled — and there it falls back to the points either side, which are
 * then a window apart or further and so no noisier than the window would have been.
 * That fallback never crosses a dropout: it takes an immediate neighbour or nothing,
 * so a gap is still terrain nobody saw. With no pair either way the gradient is
 * unknown and stays null, and the profile paints that stretch in neutral ink rather
 * than in a colour that would claim a slope.
 */
export function gradients(
  distances: readonly number[],
  altitudeM: readonly (number | null)[],
  windowM = GRADIENT_WINDOW_M,
): Array<number | null> {
  const count = distances.length
  const out = new Array<number | null>(count).fill(null)
  if (count === 0) return out

  // The nearest measured point at or after each index, and at or before it. Two
  // lookups then replace a scan of the window, which at 2 m spacing is 50 points.
  const after = new Array<number>(count)
  const before = new Array<number>(count)
  let seen = -1
  for (let i = 0; i < count; i++) {
    if (altitudeM[i] !== null) seen = i
    before[i] = seen
  }
  seen = -1
  for (let i = count - 1; i >= 0; i--) {
    if (altitudeM[i] !== null) seen = i
    after[i] = seen
  }

  const half = windowM / 2
  let low = 0
  let high = 0

  for (let i = 0; i < count; i++) {
    const here = distances[i]!
    while (distances[low]! < here - half) low++
    while (high + 1 < count && distances[high + 1]! <= here + half) high++

    let first = after[low]!
    let last = before[high]!
    if (first < 0 || last < 0 || first > high || last < low || first >= last) {
      if (altitudeM[i] === null) continue
      first = altitudeM[i - 1] === undefined || altitudeM[i - 1] === null ? i : i - 1
      last = altitudeM[i + 1] === undefined || altitudeM[i + 1] === null ? i : i + 1
      if (first === last) continue
    }

    const run = distances[last]! - distances[first]!
    if (run <= 0) continue
    out[i] = ((altitudeM[last]! - altitudeM[first]!) / run) * 100
  }

  return out
}

/**
 * Which of the track's points the profile actually draws.
 *
 * Shape-driven, not uniform. Ramer–Douglas–Peucker with a *vertical* tolerance keeps
 * any point whose removal would move the drawn altitude by more than `toleranceM`, so
 * points cluster through a switchbacked col and thin out along a canal drag, and every
 * local minimum and maximum deeper than the tolerance survives exactly — which is what
 * makes the axis labels and the drawn line agree about where the summit is.
 *
 * Simplification alone leaves no floor under the cursor, though: a long even climb can
 * reduce to its two ends, and hovering it would then snap kilometres at a time. So any
 * surviving span longer than `capM` is subdivided again with real points. The cap is
 * cursor resolution and nothing else; the shape is entirely the tolerance's business.
 *
 * Every index returned is a point the track actually recorded, which is what keeps the
 * map marker on a real coordinate. Runs of measured altitude are simplified one at a
 * time and never across a dropout, and each dropout contributes one unmeasured index
 * so the drawn line still breaks where the data did.
 */
export function drawnIndices(
  distances: readonly number[],
  altitudeM: readonly (number | null)[],
  toleranceM: number,
  capM: number,
): number[] {
  const out: number[] = []
  const count = distances.length
  let i = 0

  while (i < count) {
    if (altitudeM[i] === null) {
      // One point stands for the whole dropout: `connectNulls: false` needs a null
      // datum to break on, and the gap's width comes from the measured points either
      // side of it rather than from how many nulls lie between them.
      out.push(i)
      while (i < count && altitudeM[i] === null) i++
      continue
    }

    const start = i
    while (i < count && altitudeM[i] !== null) i++
    spread(out, distances, simplify(distances, altitudeM, start, i - 1, toleranceM), capM)
  }

  return out
}

/** Ramer–Douglas–Peucker over one measured run, deviation measured vertically. */
function simplify(
  distances: readonly number[],
  altitudeM: readonly (number | null)[],
  start: number,
  end: number,
  toleranceM: number,
): number[] {
  const keep = new Uint8Array(end - start + 1)
  keep[0] = 1
  keep[end - start] = 1

  // An explicit stack rather than recursion: a 34k-point run splits deeply enough on
  // real terrain to be worth not finding out where the engine's limit is.
  const pending: Array<[number, number]> = [[start, end]]
  while (pending.length > 0) {
    const [from, to] = pending.pop()!
    if (to - from < 2) continue

    const base = altitudeM[from]!
    const rise = altitudeM[to]! - base
    const run = distances[to]! - distances[from]!

    let worst = -1
    let deepest = toleranceM
    for (let at = from + 1; at < to; at++) {
      const projected = run > 0 ? base + (rise * (distances[at]! - distances[from]!)) / run : base
      const deviation = Math.abs(altitudeM[at]! - projected)
      if (deviation > deepest) {
        deepest = deviation
        worst = at
      }
    }
    if (worst < 0) continue

    keep[worst - start] = 1
    pending.push([from, worst], [worst, to])
  }

  const kept: number[] = []
  for (let at = 0; at <= end - start; at++) if (keep[at]) kept.push(start + at)
  return kept
}

/** Appends a simplified run, subdividing anything the cap says is too far apart. */
function spread(out: number[], distances: readonly number[], kept: number[], capM: number): void {
  out.push(kept[0]!)

  for (let k = 1; k < kept.length; k++) {
    const from = kept[k - 1]!
    const to = kept[k]!
    const span = distances[to]! - distances[from]!
    const parts = capM > 0 ? Math.ceil(span / capM) : 1

    for (let step = 1; step < parts; step++) {
      const at = nearestInSorted(distances, distances[from]! + (span * step) / parts)
      if (at > out[out.length - 1]! && at < to) out.push(at)
    }
    out.push(to)
  }
}
