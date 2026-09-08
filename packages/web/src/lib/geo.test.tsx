import { describe, expect, it } from 'vitest'
import {
  cumulativeDistances,
  drawnIndices,
  gradients,
  nearestIndex,
  nearestInSorted,
  nearestOnPath,
} from './geo.ts'

/** One degree of latitude on the sphere the haversine above is written against. */
const DEGREE_M = 111_195

describe('cumulativeDistances', () => {
  it('measures along the track, starting at zero', () => {
    const out = cumulativeDistances(
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      null,
    )

    expect(out[0]).toBe(0)
    expect(out[1]).toBeCloseTo(DEGREE_M, -1)
    expect(out[2]).toBeCloseTo(2 * DEGREE_M, -1)
  })

  /**
   * The whole reason this function takes a reported distance at all: the axis under a
   * tile reading 87.4 km must not end at 87.1. The correction is spread, so a point
   * halfway along stays halfway along.
   */
  it('lands the last point exactly on the reported distance', () => {
    const out = cumulativeDistances(
      [
        [0, 0],
        [0, 1],
        [0, 2],
      ],
      200_000,
    )

    expect(out.at(-1)).toBe(200_000)
    expect(out[1]).toBeCloseTo(100_000, 5)
  })

  it('keeps the raw sum when nothing was reported', () => {
    const out = cumulativeDistances(
      [
        [0, 0],
        [0, 1],
      ],
      null,
    )
    expect(out.at(-1)).toBeCloseTo(DEGREE_M, -1)
  })

  // A stationary recording has a reported distance and no length to spread it over.
  // Scaling it would be a division by zero, and every reading downstream a NaN.
  it('does not scale a track that went nowhere', () => {
    const out = cumulativeDistances(
      [
        [11, 47],
        [11, 47],
      ],
      5_000,
    )
    expect(out).toEqual([0, 0])
  })
})

describe('nearestIndex', () => {
  it('finds the closest point', () => {
    const index = nearestIndex(
      [
        [11.0, 47.0],
        [11.1, 47.0],
        [11.2, 47.0],
      ],
      11.09,
      47.0,
    )
    expect(index).toBe(1)
  })

  /**
   * At 60°N a degree of longitude is half a degree of latitude on the ground. Compared
   * in raw degrees the point 0.011° north looks nearer than the one 0.02° east, and it
   * is not — the cursor would land on the wrong side of a hairpin.
   */
  it('weights longitude by the latitude it is at', () => {
    const east: [number, number] = [0.02, 60]
    const north: [number, number] = [0, 60.011]

    expect(nearestIndex([east, north], 0, 60)).toBe(0)
  })

  it('has no answer for an empty track', () => {
    expect(nearestIndex([], 0, 0)).toBe(-1)
  })
})

describe('nearestInSorted', () => {
  const distances = [0, 100, 200, 300]

  it('picks the nearer of the two it falls between', () => {
    expect(nearestInSorted(distances, 149)).toBe(1)
    expect(nearestInSorted(distances, 151)).toBe(2)
  })

  it('clamps to the ends', () => {
    expect(nearestInSorted(distances, -50)).toBe(0)
    expect(nearestInSorted(distances, 9_000)).toBe(3)
  })
})

/** A track sampled every `spacingM`, climbing at a constant percent. */
function ramp(spacingM: number, lengthM: number, percent: number) {
  const count = Math.round(lengthM / spacingM) + 1
  const distances = Array.from({ length: count }, (_, i) => i * spacingM)
  const altitudeM = distances.map((d) => 1000 + (d * percent) / 100)
  return { distances, altitudeM }
}

describe('gradients', () => {
  it('reads a constant slope as that slope, everywhere', () => {
    const { distances, altitudeM } = ramp(10, 1000, 6)
    for (const measured of gradients(distances, altitudeM)) expect(measured).toBeCloseTo(6, 6)
  })

  /**
   * The point of measuring across metres rather than across points: the same hill
   * recorded on foot and on a bike is the same hill.
   */
  it('gives the same answer at two point spacings', () => {
    const walked = ramp(2, 1000, 8)
    const ridden = ramp(15, 1005, 8)
    expect(gradients(walked.distances, walked.altitudeM)[25]).toBeCloseTo(
      gradients(ridden.distances, ridden.altitudeM)[25]!,
      6,
    )
  })

  // At the ends there is only half a window, so it narrows onto what it can reach.
  it('narrows the window at the ends of the track', () => {
    const { distances, altitudeM } = ramp(10, 1000, 6)
    expect(gradients(distances, altitudeM)[0]).toBeCloseTo(6, 6)
    expect(gradients(distances, altitudeM).at(-1)).toBeCloseTo(6, 6)
  })

  it('smooths an altimeter rather than reporting it', () => {
    const { distances, altitudeM } = ramp(10, 1000, 6)
    // ±1 m of noise on every other point, which point-to-point reads as ±10%.
    const noisy = altitudeM.map((value, i) => (i % 2 === 0 ? value + 1 : value - 1))
    for (const measured of gradients(distances, noisy).slice(10, 90)) {
      expect(measured).toBeGreaterThan(5)
      expect(measured).toBeLessThan(7)
    }
  })

  /** A dropout wider than the window leaves nothing to measure a slope across. */
  it('has no gradient where the window cannot be filled', () => {
    const distances = Array.from({ length: 41 }, (_, i) => i * 10)
    const altitudeM = distances.map((_, i) => (i > 5 && i < 35 ? null : 500 + i))
    const measured = gradients(distances, altitudeM, 100)

    expect(measured[20]).toBeNull()
    expect(measured[0]).not.toBeNull()
  })
})

describe('drawnIndices', () => {
  const straight = ramp(10, 1000, 6)

  it('reduces a straight climb to its ends, then to what the cap allows', () => {
    // No cap: RDP alone has nothing to keep in the middle of a straight line.
    expect(drawnIndices(straight.distances, straight.altitudeM, 1, 0)).toEqual([0, 100])

    // With one, no two drawn points are further apart than it.
    const capped = drawnIndices(straight.distances, straight.altitudeM, 1, 250)
    expect(capped).toEqual([0, 25, 50, 75, 100])
  })

  it('keeps a summit exactly, whatever the cap would have chosen', () => {
    const distances = Array.from({ length: 21 }, (_, i) => i * 10)
    // A single peak at index 7, well off the line between the two ends.
    const altitudeM = distances.map((_, i) => (i <= 7 ? 500 + i * 20 : 640 - (i - 7) * 10))
    const drawn = drawnIndices(distances, altitudeM, 1, 1000)

    expect(drawn).toContain(7)
    const heights = drawn.map((at) => altitudeM[at]!)
    expect(Math.max(...heights)).toBe(Math.max(...altitudeM))
    expect(Math.min(...heights)).toBe(Math.min(...altitudeM))
  })

  it('discards what the tolerance says is noise', () => {
    const distances = Array.from({ length: 21 }, (_, i) => i * 10)
    // A 0.4 m wobble on a flat track: under a 1 m tolerance, nothing worth a point.
    const altitudeM = distances.map((_, i) => 500 + (i % 2) * 0.4)
    expect(drawnIndices(distances, altitudeM, 1, 0)).toEqual([0, 20])
  })

  it('draws every point it returns from the track itself, in order', () => {
    const distances = Array.from({ length: 60 }, (_, i) => i * 10)
    const altitudeM = distances.map((d) => 500 + Math.sin(d / 90) * 40)
    const drawn = drawnIndices(distances, altitudeM, 1, 100)

    for (const at of drawn) expect(distances[at]).toBeDefined()
    for (let k = 1; k < drawn.length; k++) expect(drawn[k]!).toBeGreaterThan(drawn[k - 1]!)
    for (let k = 1; k < drawn.length; k++) {
      expect(distances[drawn[k]!]! - distances[drawn[k - 1]!]!).toBeLessThanOrEqual(100)
    }
  })

  /**
   * A dropout is simplified around, never across — and it contributes one unmeasured
   * index, because `connectNulls: false` needs a null datum to break the line on.
   */
  it('keeps a dropout as a gap in what it draws', () => {
    const distances = Array.from({ length: 30 }, (_, i) => i * 10)
    const altitudeM = distances.map((_, i) => (i >= 10 && i < 20 ? null : 500 + i))
    const drawn = drawnIndices(distances, altitudeM, 1, 1000)

    const missing = drawn.filter((at) => altitudeM[at] === null)
    expect(missing).toHaveLength(1)
    expect(missing[0]).toBe(10)
    expect(drawn).toContain(9)
    expect(drawn).toContain(20)
  })
})

describe('nearestOnPath', () => {
  // A straight line east along the equator, one degree between the two points.
  const beeline: Array<[number, number]> = [
    [0, 0],
    [1, 0],
  ]

  it('measures to the segment, not to whichever end happens to be closer', () => {
    // The whole reason this exists: an unrouted leg is two distant points, and a click
    // in the middle of it is far from both. Vertex distance would call this ~55 km.
    const hit = nearestOnPath(beeline, 0.5, 0)
    expect(hit.distanceM).toBeCloseTo(0, 5)
    expect(hit.position).toBeCloseTo(0.5, 6)
  })

  it('reports how far along, so points on one leg can be ordered', () => {
    expect(nearestOnPath(beeline, 0.25, 0).position).toBeCloseTo(0.25, 6)
    expect(nearestOnPath(beeline, 0.75, 0).position).toBeCloseTo(0.75, 6)
  })

  it('clamps to the ends rather than running off them', () => {
    expect(nearestOnPath(beeline, -1, 0).position).toBe(0)
    expect(nearestOnPath(beeline, 5, 0).position).toBe(1)
  })

  it('measures the perpendicular offset in metres', () => {
    // A hundredth of a degree of latitude is ~1113 m.
    expect(nearestOnPath(beeline, 0.5, 0.01).distanceM).toBeCloseTo(1113.2, 0)
  })

  it('is infinitely far from a path with no segments', () => {
    expect(nearestOnPath([], 0, 0).distanceM).toBe(Number.POSITIVE_INFINITY)
    expect(nearestOnPath([[0, 0]], 0, 0).distanceM).toBe(Number.POSITIVE_INFINITY)
  })
})
