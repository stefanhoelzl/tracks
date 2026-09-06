import type { Trend } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { buildTrendOption } from './VolumeTrend.tsx'

/**
 * The option, as a value.
 *
 * The same discipline the elevation profile follows: what a chart *decides* — which
 * bands stack, where an empty bucket goes, which labels survive — is decided in a
 * pure function, so it can be asserted without a canvas, a layout or a mount.
 */

type Built = {
  series: Array<{ name: string; data: number[]; itemStyle: { color: string } }>
  xAxis: { data: string[]; axisLabel: { interval: (i: number, key: string) => boolean } }
  tooltip: { formatter: (params: unknown) => string }
}

const DATA: Trend = {
  keys: ['2025-09', '2025-10', '2025-11'],
  series: [
    { value: 'bike', values: [40_000, 0, 20_000] },
    { value: null, values: [10_000, 0, 0] },
  ],
  totals: [50_000, 0, 20_000],
  counts: [3, 0, 1],
}

const build = (over: Partial<Parameters<typeof buildTrendOption>[1]> = {}) =>
  buildTrendOption(DATA, {
    metric: 'distance',
    splitBy: 'sport',
    colour: (value) => (value === null ? '#8a9691' : '#0a6b48'),
    labelEvery: () => true,
    ...over,
  }) as unknown as Built

describe('the volume trend option', () => {
  it('stacks one series per band, in the order the aggregation put them', () => {
    const option = build()
    const stacked = option.series.filter((s) => s.name !== 'empty')

    expect(stacked.map((s) => s.name)).toEqual(['bike', 'not set'])
    expect(stacked.map((s) => s.data)).toEqual([
      [40_000, 0, 20_000],
      [10_000, 0, 0],
    ])
    // The band with no tag takes the neutral, the same grey *not set* wears in the
    // sidebar and on the map.
    expect(stacked[1]?.itemStyle.color).toBe('#8a9691')
  })

  it('draws a stub where a bucket is empty, because a zero bar draws nothing', () => {
    const stub = build().series.find((s) => s.name === 'empty')

    // A month you did not ride has to look different from a month that fell off the
    // end of the axis, and at zero height those are the same picture.
    expect(stub?.data).toEqual([0, 3, 0])
  })

  it('says the total and the count before the bands, and drops the stub from the tooltip', () => {
    const text = build().tooltip.formatter([
      { dataIndex: 0, seriesName: 'bike', value: 40_000 },
      { dataIndex: 0, seriesName: 'not set', value: 10_000 },
      { dataIndex: 0, seriesName: 'empty', value: 0 },
    ])

    expect(text).toContain('2025-09')
    expect(text).toContain('50 km')
    expect(text).toContain('3 activities')
    expect(text).toContain('bike&nbsp;&nbsp;40 km')
    expect(text).not.toContain('empty')
  })

  it('does not list bands when only one is present', () => {
    const text = build().tooltip.formatter([{ dataIndex: 2, seriesName: 'bike', value: 20_000 }])

    // One band and one total are the same number said twice.
    expect(text).toBe('2025-11<br/>20 km · 1 activities')
  })

  it('has no bands at all when nothing is being split by', () => {
    const option = build({ splitBy: null })
    expect(option.series.filter((s) => s.name !== 'empty').map((s) => s.name)).toEqual([
      'bike',
      'not set',
    ])
    expect(option.tooltip.formatter([{ dataIndex: 0, seriesName: 'bike', value: 40_000 }])).toBe(
      '2025-09<br/>50 km · 3 activities',
    )
  })
})
