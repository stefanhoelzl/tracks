import type { ActivityTrack } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { buildProfileOption, profileOf } from './ElevationProfile.tsx'

type Built = {
  xAxis: { min: number; max: number }
  yAxis: { min: number; max: number; interval: number }
  series: Array<{
    data: Array<[number, number | null]>
    sampling: string
    connectNulls: boolean
  }>
}

/** A track running due north, one degree at a time, with altitudes to match. */
function track(altitudeM: Array<number | null>): ActivityTrack {
  return {
    coordinates: altitudeM.map((_, index): [number, number] => [0, index]),
    altitudeM,
  }
}

const build = (altitudeM: Array<number | null>, totalM = 1000) =>
  buildProfileOption({
    distances: altitudeM.map((_, i) => (i * totalM) / (altitudeM.length - 1)),
    altitudeM,
    totalM,
  }) as unknown as Built

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
    }
    expect(profileOf(stationary, null)).toBeNull()
  })

  it('scales its distances onto the reported one', () => {
    const profile = profileOf(track([500, 600, 700]), 40_000)!
    expect(profile.totalM).toBe(40_000)
    expect(profile.distances.at(-1)).toBe(40_000)
  })
})

describe('buildProfileOption', () => {
  it('runs the x axis from zero to the length of the track', () => {
    const option = build([500, 900], 87_400)
    expect(option.xAxis.min).toBe(0)
    expect(option.xAxis.max).toBe(87_400)
  })

  // Two labels, and the lower of them is a height that was actually recorded.
  it('starts the y axis at the lowest point on the track', () => {
    const option = build([610, 2480, 1200])
    expect(option.yAxis.min).toBe(610)
    expect(option.yAxis.max).toBe(2480)
    expect(option.yAxis.interval).toBe(2480 - 610)
  })

  /**
   * Without a floor, a 25 m rolling ride fills the box exactly as a col does, and the
   * shape — which is the only thing this chart is for — stops meaning anything.
   */
  it('will not let a flat ride draw like a mountain', () => {
    const option = build([480, 505, 490])
    expect(option.yAxis.min).toBe(480)
    expect(option.yAxis.max).toBe(680)
  })

  it('keeps the gaps where altitude was never recorded', () => {
    const option = build([500, null, 700])
    expect(option.series[0]!.data.map(([, y]) => y)).toEqual([500, null, 700])
    expect(option.series[0]!.connectNulls).toBe(false)
  })

  // Sampling is a rendering concern in ECharts: the series still holds every point,
  // which is what keeps a hover index pointing at a real coordinate on the map.
  it('decimates for the screen without dropping a point from the series', () => {
    const altitudes = Array.from({ length: 5_000 }, (_, i) => 500 + i)
    const option = build(altitudes)

    expect(option.series[0]!.sampling).toBe('lttb')
    expect(option.series[0]!.data).toHaveLength(5_000)
  })
})
