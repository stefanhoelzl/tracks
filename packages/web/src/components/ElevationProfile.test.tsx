import type { ActivityTrack } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { CHART, GRADE, gradeColour } from '../lib/chart-theme.ts'
import { buildProfileOption, profileOf } from './ElevationProfile.tsx'

type Paint = { colorStops: Array<{ offset: number; color: string }> }

type Built = {
  xAxis: { min: number; max: number }
  yAxis: { min: number; max: number; interval: number }
  tooltip: { formatter: (params: unknown) => string }
  series: Array<{
    data: Array<[number, number | null, number | null]>
    sampling: string
    connectNulls: boolean
    lineStyle: { color: Paint | string }
    areaStyle: { color: Paint | string; opacity: number }
  }>
}

/** A track running due north, one degree at a time, with altitudes to match. */
function track(altitudeM: Array<number | null>): ActivityTrack {
  return {
    coordinates: altitudeM.map((_, index): [number, number] => [0, index]),
    altitudeM,
    secondsFromStart: altitudeM.map(() => null),
  }
}

const build = (
  altitudeM: Array<number | null>,
  totalM = 1000,
  gradients: Array<number | null> = altitudeM.map(() => 0),
) =>
  buildProfileOption({
    distances: altitudeM.map((_, i) => (i * totalM) / (altitudeM.length - 1)),
    altitudeM,
    gradients,
    trackIndex: altitudeM.map((_, i) => i),
    totalM,
  }) as unknown as Built

const paintOf = (option: Built) => option.series[0]!.lineStyle.color as Paint

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

  // Sampling is a rendering concern in ECharts: the series still holds every point the
  // profile drew, which is what keeps a hover index pointing at a real coordinate.
  it('decimates for the screen without dropping a point from the series', () => {
    const altitudes = Array.from({ length: 5_000 }, (_, i) => 500 + i)
    const option = build(altitudes)

    expect(option.series[0]!.sampling).toBe('lttb')
    expect(option.series[0]!.data).toHaveLength(5_000)
  })

  it('carries the gradient alongside, for the tooltip to read', () => {
    const option = build([500, 600, 700], 1000, [2, 7, 12])
    expect(option.series[0]!.data.map(([, , gradient]) => gradient)).toEqual([2, 7, 12])
  })

  describe('the ramp', () => {
    /**
     * One gradient along the x axis paints the line and the area together, so the
     * profile reads as a coloured mass rather than a coloured hairline over a grey one.
     */
    it('paints the line and the area from the same stops', () => {
      const option = build([500, 600, 700], 1000, [0, 8, 15])
      expect(option.series[0]!.areaStyle.color).toBe(option.series[0]!.lineStyle.color)
      expect(option.series[0]!.areaStyle.opacity).toBeLessThan(0.3)
    })

    it('places a stop at each point, on the ramp its gradient falls on', () => {
      const option = build([500, 600, 700], 1000, [-8, 4, 15])
      expect(paintOf(option).colorStops).toEqual([
        { offset: 0, color: GRADE[0].colour },
        { offset: 0.5, color: GRADE[2].colour },
        { offset: 1, color: GRADE[5].colour },
      ])
    })

    // Offsets are fractions of the drawn line's own box, which starts at the first
    // point carrying an altitude and not at the start of the track.
    it('measures its offsets across what is actually drawn', () => {
      const option = build([null, 500, 600], 1000, [null, 0, 15])
      expect(paintOf(option).colorStops.map((stop) => stop.offset)).toEqual([0, 1])
    })

    it('keeps both ends of a run of one colour and nothing between them', () => {
      const option = build([500, 520, 540, 560, 700], 1000, [4, 4, 4, 4, 15])
      expect(paintOf(option).colorStops).toEqual([
        { offset: 0, color: GRADE[2].colour },
        { offset: 0.75, color: GRADE[2].colour },
        { offset: 1, color: GRADE[5].colour },
      ])
    })

    // Neutral ink kept its place in the palette by becoming a value: we do not know.
    it('draws an unmeasurable stretch in neutral ink', () => {
      const option = build([500, 600, 700], 1000, [4, null, 15])
      expect(paintOf(option).colorStops[1]!.color).toBe(CHART.ink)
    })
  })

  describe('the tooltip', () => {
    const readout = (altitude: number | null, gradient: number | null) =>
      build([500, 600], 1000, [0, 0]).tooltip.formatter([{ value: [12_400, altitude, gradient] }])

    it('names the distance, the height and the gradient', () => {
      expect(readout(840, 7.42)).toContain('km 12.4 · 840 m · ')
      expect(readout(840, 7.42)).toContain('+7.4%')
    })

    // Signed always: the colour says how hard, the sign says which way.
    it('signs the gradient in both directions', () => {
      expect(readout(612, -5.2)).toContain('-5.2%')
      expect(readout(612, 0)).toContain('+0.0%')
    })

    it('paints the figure the colour the line under it is drawn in', () => {
      expect(readout(840, 7.42)).toContain(`color:${gradeColour(7.42)}`)
    })

    it('says only what it knows where there is no altitude or no gradient', () => {
      expect(readout(null, 4)).toBe('km 12.4')
      expect(readout(840, null)).toBe('km 12.4 · 840 m')
    })
  })
})
