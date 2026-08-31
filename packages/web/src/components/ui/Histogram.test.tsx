import { describe, expect, it } from 'vitest'
import { buildHistogramOption } from './Histogram.tsx'

/**
 * The option is the unit. Everything this chart decides happens while the option is
 * being built — where a bar sits, where the wash outside the selection starts and
 * stops — and none of it needs a rendered pixel to be wrong in a way that matters.
 */

type Built = {
  xAxis: { min: number; max: number }
  yAxis: { max: number }
  series: Array<{
    data: Array<[number, number]>
    markArea: { z: number; data: Array<[{ xAxis: number }, { xAxis: number }]> }
  }>
}

const build = (
  buckets: number[],
  bounds: { axisMin: number; axisMax: number; low: number; high: number },
) => buildHistogramOption(buckets, bounds) as unknown as Built

const UNBOUNDED = { axisMin: 0, axisMax: 100, low: 0, high: 100 }

describe('buildHistogramOption', () => {
  it('plots each bucket at its own centre, across the whole axis', () => {
    const option = build([3, 1, 4], UNBOUNDED)

    // Three equal buckets over [0, 100]: centres at a sixth, a half, five sixths.
    const centres = option.series[0]!.data.map(([x]) => x)
    expect(centres[0]).toBeCloseTo(100 / 6, 9)
    expect(centres[1]).toBeCloseTo(50, 9)
    expect(centres[2]).toBeCloseTo(500 / 6, 9)
    expect(option.series[0]!.data.map(([, y]) => y)).toEqual([3, 1, 4])
    expect(option.xAxis.min).toBe(0)
    expect(option.xAxis.max).toBe(100)
  })

  // ECharts would round the top up to a nice number and leave the tallest bar short
  // of the box. A decorative distribution should fill the space it is given.
  it('pins the top of the axis to the tallest bucket', () => {
    expect(build([3, 1, 4], UNBOUNDED).yAxis.max).toBe(4)
  })

  it('survives a facet where nothing matches', () => {
    expect(build([0, 0], UNBOUNDED).yAxis.max).toBe(1)
  })

  it('dims nothing while both ends are unbounded', () => {
    expect(build([1, 1], UNBOUNDED).series[0]!.markArea.data).toEqual([])
  })

  /**
   * The reason the bars are plotted on a value axis at all. A handle stops wherever
   * the pointer left it, and the wash has to start there — not at the edge of
   * whichever bucket happens to contain it.
   */
  it('starts the wash exactly at the handle, mid-bucket or not', () => {
    const option = build([1, 1, 1, 1], { axisMin: 0, axisMax: 100, low: 37, high: 62 })

    expect(option.series[0]!.markArea.data).toEqual([
      [{ xAxis: 0 }, { xAxis: 37 }],
      [{ xAxis: 62 }, { xAxis: 100 }],
    ])
  })

  /**
   * A markArea at its natural depth paints *behind* the series, where it tints the
   * gaps between bars and leaves the bars themselves at full strength — which is a
   * grey box drawn on the sidebar rather than a dimmed range. Above the series (2)
   * is the difference between the wash working and the wash being decoration.
   */
  it('washes over the bars rather than behind them', () => {
    const option = build([1, 1], { axisMin: 0, axisMax: 100, low: 20, high: 100 })
    expect(option.series[0]!.markArea.z).toBeGreaterThan(2)
  })

  it('dims only the end that is actually narrowed', () => {
    const option = build([1, 1], { axisMin: 0, axisMax: 100, low: 0, high: 40 })
    expect(option.series[0]!.markArea.data).toEqual([[{ xAxis: 40 }, { xAxis: 100 }]])
  })
})
