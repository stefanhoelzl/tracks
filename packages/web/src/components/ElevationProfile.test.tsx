import type { ActivityTrack } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { CHART, GRADE } from '../lib/chart-theme.ts'
import { profileOf, rampStops } from './ElevationProfile.tsx'

/** A track running due north, one degree at a time, with altitudes to match. */
function track(altitudeM: Array<number | null>): ActivityTrack {
  return {
    coordinates: altitudeM.map((_, index): [number, number] => [0, index]),
    altitudeM,
    secondsFromStart: altitudeM.map(() => null),
  }
}

const ramp = (altitudeM: Array<number | null>, gradients: Array<number | null>, totalM = 1000) =>
  rampStops({
    distances: altitudeM.map((_, i) => (i * totalM) / (altitudeM.length - 1)),
    altitudeM,
    gradients,
    trackIndex: altitudeM.map((_, i) => i),
    totalM,
  })

describe('profileOf', () => {
  it('has nothing to draw when no point carries an altitude', () => {
    expect(profileOf(track([null, null, null]), 1000)).toBeNull()
  })

  it('has nothing to draw from a single measured point', () => {
    expect(profileOf(track([1500, null]), 1000)).toBeNull()
  })

  it('has nothing to draw for a track that went nowhere', () => {
    const stationary: ActivityTrack = {
      coordinates: [
        [11, 47],
        [11, 47],
      ],
      altitudeM: [500, 501],
      secondsFromStart: [0, 1],
    }
    expect(profileOf(stationary, null)).toBeNull()
  })

  it('scales its distances onto the reported one', () => {
    const profile = profileOf(track([500, 600, 700]), 40_000)!
    expect(profile.totalM).toBe(40_000)
    expect(profile.distances.at(-1)).toBe(40_000)
  })

  /**
   * The profile draws a simplification, so it has to carry the way back: every point
   * it drew is one the track recorded, and the map marker is placed from that index.
   */
  it('draws only points the track actually recorded', () => {
    const profile = profileOf(track(Array.from({ length: 200 }, (_, i) => 500 + i * 3)), 40_000)!

    for (const at of profile.trackIndex) expect(at).toBeLessThan(200)
    for (let k = 1; k < profile.trackIndex.length; k++) {
      expect(profile.trackIndex[k]!).toBeGreaterThan(profile.trackIndex[k - 1]!)
    }
    expect(profile.distances).toHaveLength(profile.trackIndex.length)
    expect(profile.gradients).toHaveLength(profile.trackIndex.length)
  })

  // Simplification is not allowed to shave the summit: the y axis names it.
  it('keeps the highest and lowest points it was given', () => {
    const altitudes = Array.from({ length: 300 }, (_, i) => 500 + Math.sin(i / 12) * 400)
    const profile = profileOf(track(altitudes), 40_000)!
    const drawn = profile.altitudeM.filter((value): value is number => value !== null)

    expect(Math.max(...drawn)).toBe(Math.max(...altitudes))
    expect(Math.min(...drawn)).toBe(Math.min(...altitudes))
  })

  /**
   * 199 steps of 4 m over a track scaled to 40 km, so a shade under 2% all the way —
   * and measured all the way, even though the points are 201 m apart and the window is
   * 100 m. A coarse recording is not a dropout.
   */
  it('measures a gradient for every point it drew', () => {
    const profile = profileOf(track(Array.from({ length: 200 }, (_, i) => 500 + i * 4)), 40_000)!
    const expected = (4 / (40_000 / 199)) * 100

    expect(profile.gradients).not.toContain(null)
    for (const gradient of profile.gradients) expect(gradient).toBeCloseTo(expected, 6)
  })
})

describe('the ramp', () => {
  /**
   * One gradient along the x axis paints the line and the area together, so the profile
   * reads as a coloured mass rather than a coloured hairline over a grey one. Both paths
   * take the same `<linearGradient>`, which is what these stops become.
   */
  it('places a stop at each point, on the ramp its gradient falls on', () => {
    expect(ramp([500, 600, 700], [-8, 4, 15])?.stops).toEqual([
      { offset: 0, colour: GRADE[0].colour },
      { offset: 0.5, colour: GRADE[2].colour },
      { offset: 1, colour: GRADE[5].colour },
    ])
  })

  // Offsets are fractions of the drawn line's own extent, which starts at the first point
  // carrying an altitude and not at the start of the track.
  it('measures its offsets across what is actually drawn', () => {
    const painted = ramp([null, 500, 600], [null, 0, 15])
    expect(painted?.stops.map((stop) => stop.offset)).toEqual([0, 1])
    expect(painted?.fromM).toBe(500)
    expect(painted?.spanM).toBe(500)
  })

  it('keeps both ends of a run of one colour and nothing between them', () => {
    expect(ramp([500, 520, 540, 560, 700], [4, 4, 4, 4, 15])?.stops).toEqual([
      { offset: 0, colour: GRADE[2].colour },
      { offset: 0.75, colour: GRADE[2].colour },
      { offset: 1, colour: GRADE[5].colour },
    ])
  })

  // Neutral ink kept its place in the palette by becoming a value: we do not know.
  it('draws an unmeasurable stretch in neutral ink', () => {
    expect(ramp([500, 600, 700], [4, null, 15])?.stops[1]?.colour).toBe(CHART.ink)
  })

  it('has nothing to lay a ramp along when nothing is measured', () => {
    expect(ramp([null, null], [null, null])).toBeNull()
  })
})
