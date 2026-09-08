/**
 * Measurements over a decoded track.
 *
 * All of it is derived, none of it is stored. The brief's reason for rejecting
 * self-computed metrics still holds — a segment has to be measured dynamically
 * whatever we do, so measuring the whole track the same way is one code path rather
 * than two — and these are the two measurements the elevation profile needs.
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
 * The index nearest a distance along the track.
 *
 * Binary search, because the array it searches is sorted by construction — this one
 * runs on every pointer move across the chart, where the scan above is answering a
 * question that has no order to exploit.
 */
export function indexAtDistance(distances: readonly number[], target: number): number {
  if (distances.length === 0) return -1

  let low = 0
  let high = distances.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (distances[mid]! < target) low = mid + 1
    else high = mid
  }

  const here = distances[low]!
  const before = distances[low - 1]
  if (before !== undefined && Math.abs(before - target) < Math.abs(here - target)) return low - 1
  return low
}
