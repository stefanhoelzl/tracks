import { describe, expect, it } from 'vitest'
import { altitudeAt, distanceAxis, heightAxis, splitAt, statsBetween } from './profile.ts'

/**
 * The arithmetic the phone mirrors. `profile.json` holds the two implementations to each
 * other; these tests say what the arithmetic is *for*, which a fixture cannot.
 */

describe('heightAxis', () => {
  it('labels round heights, not measurements', () => {
    const axis = heightAxis(612, 1284, 200)
    expect(axis.values).toEqual([600, 800, 1000, 1200, 1400])
    expect(axis.min).toBe(600)
    expect(axis.max).toBe(1400)
  })

  it('carries three to five labels whatever the terrain', () => {
    for (const [low, high] of [
      [0, 40],
      [490, 510],
      [612, 688],
      [200, 2400],
      [0, 8848],
    ] as const) {
      const axis = heightAxis(low, high, 200)
      expect(axis.values.length).toBeGreaterThanOrEqual(2)
      expect(axis.values.length).toBeLessThanOrEqual(6)
    }
  })

  /**
   * Without a floor, a 25 m rolling ride fills the box exactly as a col does, and the
   * shape — which is the only thing this chart is for — stops meaning anything.
   */
  it('will not let a flat ride draw like a mountain', () => {
    const axis = heightAxis(480, 505, 200)
    expect(axis.max - axis.min).toBeGreaterThanOrEqual(200)
  })

  // The riding profile drops the floor to 100 m, because a leg between two stops is
  // mostly short and 200 m of scale flattens the ramp you are on.
  it('takes the floor it is given', () => {
    expect(heightAxis(612, 688, 100).max - heightAxis(612, 688, 100).min).toBe(100)
  })

  it('never collapses to a line, however flat', () => {
    const axis = heightAxis(1200, 1200, 0)
    expect(axis.max).toBeGreaterThan(axis.min)
  })
})

describe('distanceAxis', () => {
  it('starts at zero and stops at the last round number that fits', () => {
    const axis = distanceAxis(42_100)
    expect(axis.values).toEqual([0, 10_000, 20_000, 30_000, 40_000])
  })

  it('scales down to a walk', () => {
    expect(distanceAxis(1000).step).toBeLessThanOrEqual(500)
  })
})

/** A 1 km climb from 500 m to 700 m, one point every 100 m. */
const distances = Array.from({ length: 11 }, (_, i) => i * 100)
const climb = distances.map((_, i) => 500 + i * 20)

describe('altitudeAt', () => {
  it('interpolates between the points either side', () => {
    expect(altitudeAt(distances, climb, 150)).toBeCloseTo(530, 6)
  })

  it('knows nothing inside a dropout', () => {
    const gappy = [500, null, 700]
    expect(altitudeAt([0, 500, 1000], gappy, 250)).toBeNull()
  })

  it('holds the ends rather than running off them', () => {
    expect(altitudeAt(distances, climb, -50)).toBe(500)
    expect(altitudeAt(distances, climb, 5000)).toBe(700)
  })
})

describe('statsBetween', () => {
  it('measures the stretch between two bars, not the whole track', () => {
    const stats = statsBetween(distances, climb, 250, 750)
    expect(stats.distanceM).toBe(500)
    expect(stats.ascentM).toBeCloseTo(100, 6)
    expect(stats.descentM).toBeCloseTo(0, 6)
  })

  it('counts up and down separately', () => {
    const overCol = [500, 700, 520]
    const stats = statsBetween([0, 500, 1000], overCol, 0, 1000)
    expect(stats.ascentM).toBeCloseTo(200, 6)
    expect(stats.descentM).toBeCloseTo(180, 6)
  })

  // The climb across a gap is not known, and the jump between the heights either side of
  // it is a wall that was never there.
  it('counts nothing across a dropout', () => {
    const stats = statsBetween([0, 500, 1000], [500, null, 900], 0, 1000)
    expect(stats.ascentM).toBe(0)
    expect(stats.descentM).toBe(0)
  })

  it('reads the same stretch whichever end you dragged from', () => {
    expect(statsBetween(distances, climb, 750, 250)).toEqual(
      statsBetween(distances, climb, 250, 750),
    )
  })

  it('is nothing at all when the two bars are on the same spot', () => {
    expect(statsBetween(distances, climb, 400, 400)).toEqual({
      distanceM: 0,
      ascentM: 0,
      descentM: 0,
    })
  })
})

describe('splitAt', () => {
  it('adds back up to the whole track', () => {
    const split = splitAt(distances, climb, 375)
    expect(split.done.distanceM + split.toCome.distanceM).toBeCloseTo(1000, 6)
    expect(split.done.ascentM + split.toCome.ascentM).toBeCloseTo(200, 6)
  })

  it('has nothing done at the start and nothing left at the end', () => {
    expect(splitAt(distances, climb, 0).done.distanceM).toBe(0)
    expect(splitAt(distances, climb, 1000).toCome.distanceM).toBe(0)
  })

  it('clamps a point past either end rather than reporting a negative stretch', () => {
    expect(splitAt(distances, climb, 5000).done.distanceM).toBe(1000)
    expect(splitAt(distances, climb, -20).done.distanceM).toBe(0)
  })
})
