/**
 * Douglas-Peucker, for both sides.
 *
 * In core rather than in the server because it is exactly what core is for: a pure
 * function with no dependency, run identically by whoever needs it. The server thins
 * every track it stores; the browser thins a GPX somebody dropped as a planning
 * reference, at the same tolerance — so a reference is drawn at the same fidelity as
 * the rides underneath it rather than at one nothing else on the map has.
 */

/** What every track in this app is thinned to, on both sides. */
export const TRACK_TOLERANCE_M = 10

/** Metres per degree of latitude. Close enough anywhere for a 10 m tolerance. */
const M_PER_DEG_LAT = 111_320

/**
 * Douglas-Peucker simplification, run in metre space rather than on raw degrees.
 *
 * Simplifying degrees directly would apply a tolerance that shrinks with latitude
 * on the longitude axis, so tracks would thin unevenly depending on where they were
 * recorded. Projecting first makes the tolerance mean the same thing everywhere.
 */
export function simplify<P extends { lat: number; lon: number }>(
  points: P[],
  toleranceM = TRACK_TOLERANCE_M,
): P[] {
  if (points.length <= 2) return points

  const originLat = points[0]!.lat
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((originLat * Math.PI) / 180)
  const projected = points.map((p) => ({
    x: p.lon * mPerDegLon,
    y: p.lat * M_PER_DEG_LAT,
  }))

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  // Iterative to avoid blowing the stack on a 25k-point track.
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [first, last] = stack.pop()!
    let worst = 0
    let worstIndex = -1

    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(projected[i]!, projected[first]!, projected[last]!)
      if (d > worst) {
        worst = d
        worstIndex = i
      }
    }

    if (worstIndex !== -1 && worst > toleranceM) {
      keep[worstIndex] = 1
      stack.push([first, worstIndex], [worstIndex, last])
    }
  }

  return points.filter((_, i) => keep[i] === 1)
}

interface Pt {
  x: number
  y: number
}

function perpendicularDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y

  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)

  // Project p onto the segment, clamped to its ends.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
