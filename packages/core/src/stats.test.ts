import { describe, expect, it } from 'vitest'
import type { ActivityRow } from './api.ts'
import {
  activeYears,
  bands,
  bucketKeys,
  bucketOf,
  bucketRange,
  dayTotals,
  rampCuts,
  rampStep,
  trend,
  weekStart,
} from './stats.ts'

/**
 * The analytics aggregations, as values.
 *
 * There is no server side to these — the browser computes them from rows it already
 * holds — so this file is where the arithmetic is decided. What the charts then do is
 * turn a value into an ECharts option, which is the next thing tested.
 */

function row(over: Partial<ActivityRow> & { localDate: string }): ActivityRow {
  return {
    id: 1,
    source: 'strava',
    title: 'ride',
    startedAt: `${over.localDate}T06:00:00.000Z`,
    utcOffset: 0,
    distanceM: 10_000,
    durationS: 3_600,
    elapsedS: 3_700,
    elevationGainM: 200,
    speedMs: 2.78,
    tags: ['sport:bike'],
    ...over,
  }
}

describe('bucketing', () => {
  it('names a week by its Monday, whichever day it is asked about', () => {
    expect(weekStart('2026-09-02')).toBe('2026-08-31')
    expect(weekStart('2026-08-31')).toBe('2026-08-31')
    // Sunday belongs to the week that started six days earlier, not the next one.
    expect(weekStart('2026-09-06')).toBe('2026-08-31')
  })

  it('keys a date into its bucket', () => {
    expect(bucketOf('2026-09-02', 'year')).toBe('2026')
    expect(bucketOf('2026-09-02', 'month')).toBe('2026-09')
    expect(bucketOf('2026-09-02', 'week')).toBe('2026-08-31')
  })

  it('resolves a bucket back to the dates it covers, which is what a click filters to', () => {
    expect(bucketRange('2026', 'year')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
    expect(bucketRange('2026-09', 'month')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    // February, and a leap one, because day 0 of the next month is how it is derived.
    expect(bucketRange('2024-02', 'month')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(bucketRange('2026-08-31', 'week')).toEqual({ from: '2026-08-31', to: '2026-09-06' })
  })

  it('runs every bucket between two dates, including the ones nothing lands in', () => {
    expect(bucketKeys('2025-11-02', '2026-02-14', 'month')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
    expect(bucketKeys('2024-06-01', '2026-01-01', 'year')).toEqual(['2024', '2025', '2026'])
    expect(bucketKeys('2026-08-31', '2026-09-15', 'week')).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
    ])
  })
})

describe('the volume trend', () => {
  const rows = [
    row({ localDate: '2025-09-10', distanceM: 40_000 }),
    row({ localDate: '2025-09-20', distanceM: 60_000, tags: ['sport:hike'] }),
    row({ localDate: '2025-12-02', distanceM: 20_000 }),
  ]

  it('sums a metric per bucket, and keeps the empty buckets between', () => {
    const result = trend(rows, { bucket: 'month', metric: 'distance', splitBy: null })

    // October and November are drawn as nothing rather than skipped: a month you did
    // not ride is the thing the chart is for.
    expect(result.keys).toEqual(['2025-09', '2025-10', '2025-11', '2025-12'])
    expect(result.totals).toEqual([100_000, 0, 0, 20_000])
    expect(result.counts).toEqual([2, 0, 0, 1])
  })

  it('splits into stacked bands by a tag type', () => {
    const result = trend(rows, { bucket: 'month', metric: 'distance', splitBy: 'sport' })

    expect(result.series).toEqual([
      { value: 'bike', values: [40_000, 0, 0, 20_000] },
      { value: 'hike', values: [60_000, 0, 0, 0] },
    ])
  })

  it('stacks the activities carrying no such tag last, whatever they are called', () => {
    const result = trend([...rows, row({ localDate: '2025-09-11', tags: [] })], {
      bucket: 'month',
      metric: 'count',
      splitBy: 'sport',
    })

    // An absence is not a category, so it sits on top rather than in sort order —
    // where it stays as bands come and go.
    expect(result.series.map((s) => s.value)).toEqual(['bike', 'hike', null])
  })

  it('counts activities when that is the metric, and treats a missing number as zero', () => {
    const result = trend([row({ localDate: '2025-09-10', distanceM: null })], {
      bucket: 'year',
      metric: 'distance',
      splitBy: null,
    })

    expect(result.totals).toEqual([0])
    expect(result.counts).toEqual([1])
  })

  it('has nothing to draw for no rows', () => {
    expect(trend([], { bucket: 'month', metric: 'distance', splitBy: null })).toEqual({
      keys: [],
      series: [],
      totals: [],
      counts: [],
    })
  })
})

describe('the calendar', () => {
  const rows = [
    row({ localDate: '2025-09-10', distanceM: 40_000, durationS: 3_600 }),
    row({ localDate: '2025-09-10', distanceM: 5_000, durationS: 7_200, tags: ['sport:hike'] }),
    row({ localDate: '2025-09-12', distanceM: 20_000 }),
  ]

  it('totals a day and names the value that did most of it', () => {
    const days = dayTotals(rows, 'distance', 'sport')

    expect(days.get('2025-09-10')).toEqual({ value: 45_000, count: 2, dominant: 'bike' })
    expect(days.get('2025-09-12')).toEqual({ value: 20_000, count: 1, dominant: 'bike' })
    // A day nothing happened on is absent rather than zero: the grid draws its own
    // empty cells from the range it was asked for.
    expect(days.has('2025-09-11')).toBe(false)
  })

  it('lets the metric decide which value dominated', () => {
    // The same day: the ride is longer, the hike took twice as long.
    expect(dayTotals(rows, 'duration', 'sport').get('2025-09-10')?.dominant).toBe('hike')
  })

  it('cuts the ramp at quartiles of the days that have anything', () => {
    const days = new Map(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => [
        `2025-01-${v}`,
        { value: v, count: 1, dominant: null },
      ]),
    )
    const cuts = rampCuts(days)

    expect(cuts).toEqual([3, 6, 9])
    // One enormous day cannot flatten the rest into the lowest step, which is what an
    // equal split of the range would do.
    expect(rampStep(1, cuts)).toBe(0)
    expect(rampStep(6, cuts)).toBe(1)
    expect(rampStep(9, cuts)).toBe(2)
    expect(rampStep(400, cuts)).toBe(3)
  })

  it('has cuts of zero when nothing is in scope', () => {
    expect(rampCuts(new Map())).toEqual([0, 0, 0])
  })

  it('lists the years the rows touch', () => {
    expect(activeYears(rows.concat(row({ localDate: '2023-04-01' })))).toEqual([2023, 2025])
  })
})

describe('the distributions', () => {
  it('counts into hand-picked bands, the last one open-ended', () => {
    const result = bands(
      [
        row({ localDate: '2025-01-01', distanceM: 3_000 }),
        row({ localDate: '2025-01-02', distanceM: 12_000 }),
        row({ localDate: '2025-01-03', distanceM: 15_000 }),
        row({ localDate: '2025-01-04', distanceM: 240_000 }),
      ],
      'distance',
    )

    // 15 km lands in 15–30 rather than 5–15: bands are half-open, so a value on an
    // edge belongs to the band it opens.
    expect(result.counts).toEqual([1, 1, 1, 0, 0, 1])
    expect(result.edges.at(-1)).toEqual({ min: 100_000, max: null })
    expect(result.missing).toBe(0)
  })

  it('leaves a row with no value out of the chart entirely', () => {
    const result = bands([row({ localDate: '2025-01-01', speedMs: null })], 'speed')

    // The same rule every range facet uses for nulls, which is what keeps narrowing
    // monotonic — and here, what keeps a bar from claiming an activity has a speed.
    expect(result.counts.every((n) => n === 0)).toBe(true)
    expect(result.missing).toBe(1)
  })
})
