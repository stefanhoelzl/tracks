import { describe, expect, it } from 'vitest'
import { cumulativeDistances, indexAtDistance, nearestIndex, nearestOnPath } from './geo.ts'

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

describe('indexAtDistance', () => {
  const distances = [0, 100, 200, 300]

  it('picks the nearer of the two it falls between', () => {
    expect(indexAtDistance(distances, 149)).toBe(1)
    expect(indexAtDistance(distances, 151)).toBe(2)
  })

  it('clamps to the ends', () => {
    expect(indexAtDistance(distances, -50)).toBe(0)
    expect(indexAtDistance(distances, 9_000)).toBe(3)
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
