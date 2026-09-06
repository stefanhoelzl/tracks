import type { ActivityRow } from './api.ts'
import { parseTag } from './tags.ts'

/**
 * The analytics aggregations.
 *
 * Here rather than in the browser, and over `ActivityRow[]` rather than over a
 * database, because of what the client already holds: every row matching the filter,
 * unpaginated, carrying its local date, its tags and all four metrics. That is
 * exactly the input every analytics card needs, so there is no `/api/stats` — no
 * route, no schema, no second cache key, and changing a bucket or a metric redraws
 * without a request.
 *
 * They live in `core` all the same, beside the filter grammar and the API contract,
 * so the day a chart outgrows the rows the client holds, a route is a handler that
 * selects rows and calls the identical function. The two paths could not then
 * disagree about what a month is.
 *
 * Everything below is a pure function over rows, which is the shape the option
 * builders want and the shape a test can state as a value.
 */

export const BUCKETS = ['week', 'month', 'year'] as const
export type Bucket = (typeof BUCKETS)[number]

export const METRICS = ['distance', 'elevation', 'duration', 'count'] as const
export type Metric = (typeof METRICS)[number]

/** SI in, as everywhere else on this side of the wire: metres, seconds, or a tally. */
export function metricOf(row: ActivityRow, metric: Metric): number {
  switch (metric) {
    case 'distance':
      return row.distanceM ?? 0
    case 'elevation':
      return row.elevationGainM ?? 0
    case 'duration':
      return row.durationS ?? 0
    case 'count':
      return 1
  }
}

/** The value of a type on one activity, or null when it carries none of that type. */
export function tagValue(row: ActivityRow, type: string): string | null {
  const prefix = `${type}:`
  const tag = row.tags.find((t) => t.startsWith(prefix))
  return tag === undefined ? null : tag.slice(prefix.length)
}

/** ISO date of the Monday on or before `date`. Weeks start on Monday, as ISO says. */
export function weekStart(date: string): string {
  const at = new Date(`${date}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() - ((at.getUTCDay() + 6) % 7))
  return at.toISOString().slice(0, 10)
}

/** The key a local date falls in. A week is named by its Monday. */
export function bucketOf(date: string, bucket: Bucket): string {
  if (bucket === 'year') return date.slice(0, 4)
  if (bucket === 'month') return date.slice(0, 7)
  return weekStart(date)
}

/** The dates a bucket key covers, inclusive — what clicking a bar filters to. */
export function bucketRange(key: string, bucket: Bucket): { from: string; to: string } {
  if (bucket === 'year') return { from: `${key}-01-01`, to: `${key}-12-31` }
  if (bucket === 'month') {
    const [year, month] = [Number(key.slice(0, 4)), Number(key.slice(5, 7))]
    // Day 0 of the next month is the last day of this one, leap years included.
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
    return { from: `${key}-01`, to: last }
  }
  const end = new Date(`${key}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 6)
  return { from: key, to: end.toISOString().slice(0, 10) }
}

/** Every key from `from` to `to`, including the ones nothing lands in. */
export function bucketKeys(from: string, to: string, bucket: Bucket): string[] {
  const keys: string[] = []

  if (bucket === 'year') {
    for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
      keys.push(String(year))
    }
    return keys
  }

  if (bucket === 'month') {
    let [year, month] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
    const [endYear, endMonth] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))]
    while (year < endYear || (year === endYear && month <= endMonth)) {
      keys.push(`${year}-${String(month).padStart(2, '0')}`)
      if (month === 12) {
        month = 1
        year++
      } else month++
    }
    return keys
  }

  const at = new Date(`${weekStart(from)}T00:00:00Z`)
  const end = new Date(`${weekStart(to)}T00:00:00Z`)
  while (at <= end) {
    keys.push(at.toISOString().slice(0, 10))
    at.setUTCDate(at.getUTCDate() + 7)
  }
  return keys
}

export interface TrendSeries {
  /** The tag value this band is, or null for the activities carrying none. */
  value: string | null
  /** One number per key, in `keys` order. */
  values: number[]
}

export interface Trend {
  /** Every bucket between the first and last row, empty ones included: a gap is data. */
  keys: string[]
  /** Stacked bands, `null` last — *not set* sits on top rather than in sort order. */
  series: TrendSeries[]
  totals: number[]
  counts: number[]
}

/**
 * The volume trend: one stacked bar per bucket, split by a tag type.
 *
 * The empty buckets are the point. A month nothing landed in is a month you did not
 * ride, and a chart that omits it draws a continuous line over a winter.
 */
export function trend(
  rows: readonly ActivityRow[],
  options: { bucket: Bucket; metric: Metric; splitBy: string | null },
): Trend {
  const { bucket, metric, splitBy } = options
  if (rows.length === 0) return { keys: [], series: [], totals: [], counts: [] }

  const dates = rows.map((row) => row.localDate).sort()
  const keys = bucketKeys(dates[0]!, dates[dates.length - 1]!, bucket)
  const index = new Map(keys.map((key, i) => [key, i]))

  const bands = new Map<string | null, number[]>()
  const totals = new Array<number>(keys.length).fill(0)
  const counts = new Array<number>(keys.length).fill(0)

  for (const row of rows) {
    const at = index.get(bucketOf(row.localDate, bucket))
    if (at === undefined) continue

    const value = splitBy === null ? null : tagValue(row, splitBy)
    const band = bands.get(value) ?? new Array<number>(keys.length).fill(0)
    const amount = metricOf(row, metric)

    band[at]! += amount
    bands.set(value, band)
    totals[at]! += amount
    counts[at]!++
  }

  const series = [...bands.entries()]
    .map(([value, values]) => ({ value, values }))
    // Named values in their own order, then *not set*: an absence is not a category,
    // and stacking it last keeps it in the same place as bands come and go.
    .sort(
      (a, b) =>
        Number(a.value === null) - Number(b.value === null) ||
        (a.value ?? '').localeCompare(b.value ?? ''),
    )

  return { keys, series, totals, counts }
}

export interface DayTotal {
  value: number
  count: number
  /** The tag value that did most of the day, by the metric asked for. */
  dominant: string | null
}

/**
 * One entry per day that has anything, keyed by local date.
 *
 * Days with nothing are absent rather than zero: the calendar draws its own empty
 * cells from the range it was asked for, and a map of 2 000 zeroes to say the same
 * thing would be a map of 2 000 zeroes.
 */
export function dayTotals(
  rows: readonly ActivityRow[],
  metric: Metric,
  splitBy: string | null,
): Map<string, DayTotal> {
  const byValue = new Map<string, Map<string | null, number>>()
  const days = new Map<string, DayTotal>()

  for (const row of rows) {
    const amount = metricOf(row, metric)
    const day = days.get(row.localDate) ?? { value: 0, count: 0, dominant: null }
    day.value += amount
    day.count++
    days.set(row.localDate, day)

    if (splitBy !== null) {
      const tally = byValue.get(row.localDate) ?? new Map<string | null, number>()
      const value = tagValue(row, splitBy)
      tally.set(value, (tally.get(value) ?? 0) + amount)
      byValue.set(row.localDate, tally)
    }
  }

  for (const [date, tally] of byValue) {
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
    days.get(date)!.dominant = top?.[0] ?? null
  }

  return days
}

/**
 * The calendar ramp's three cuts: the 25th, 50th and 80th percentile of the days that
 * have anything.
 *
 * Quartiles rather than an equal split of the range, because one 200 km day would
 * otherwise put every other day in the lowest step and the year would read as empty.
 * Computed over everything in scope rather than per year, so a shade means the same
 * thing wherever it appears.
 */
export function rampCuts(days: ReadonlyMap<string, DayTotal>): [number, number, number] {
  const values = [...days.values()].map((day) => day.value).sort((a, b) => a - b)
  if (values.length === 0) return [0, 0, 0]

  const at = (p: number) => values[Math.min(values.length - 1, Math.floor(values.length * p))]!
  return [at(0.25), at(0.5), at(0.8)]
}

/** Which of the four steps a day lands on, 0–3. */
export function rampStep(value: number, cuts: readonly [number, number, number]): number {
  return value <= cuts[0] ? 0 : value <= cuts[1] ? 1 : value <= cuts[2] ? 2 : 3
}

/**
 * The bands the distribution cards count into, in SI.
 *
 * Uneven and hand-picked, unlike the sidebar's twenty-four equal buckets: 0–5, 5–15,
 * 15–30 is how a ride is talked about, and this card is a readout rather than a shape
 * to cut. The sidebar keeps the equal-width histogram, because a handle has to be
 * able to land anywhere.
 */
export const BANDS = {
  distance: [5_000, 15_000, 30_000, 60_000, 100_000],
  elevation: [100, 300, 600, 1_000, 2_000],
  duration: [3_600, 7_200, 14_400, 28_800],
  speed: [1.4, 2.8, 4.2, 5.6, 6.9],
} as const

export type BandKey = keyof typeof BANDS

export function bandValue(row: ActivityRow, key: BandKey): number | null {
  switch (key) {
    case 'distance':
      return row.distanceM
    case 'elevation':
      return row.elevationGainM
    case 'duration':
      return row.durationS
    case 'speed':
      return row.speedMs
  }
}

export interface Bands {
  /** `[min, max)` per band; the last is open-ended, so its `max` is null. */
  edges: Array<{ min: number; max: number | null }>
  counts: number[]
  /** Rows with no value at all — absent from the chart, the null rule everywhere else. */
  missing: number
}

export function bands(rows: readonly ActivityRow[], key: BandKey): Bands {
  const cuts = BANDS[key]
  const counts = new Array<number>(cuts.length + 1).fill(0)
  let missing = 0

  for (const row of rows) {
    const value = bandValue(row, key)
    if (value === null) {
      missing++
      continue
    }
    const at = cuts.findIndex((cut) => value < cut)
    counts[at === -1 ? cuts.length : at]!++
  }

  const edges = counts.map((_, i) => ({
    min: i === 0 ? 0 : cuts[i - 1]!,
    max: i === cuts.length ? null : cuts[i]!,
  }))

  return { edges, counts, missing }
}

/** Every year the rows touch, ascending — the calendar's chips. */
export function activeYears(rows: readonly ActivityRow[]): number[] {
  return [...new Set(rows.map((row) => Number(row.localDate.slice(0, 4))))].sort((a, b) => a - b)
}

/** The tag types in use, so a card can offer them without asking the registry twice. */
export function typesInUse(rows: readonly ActivityRow[]): string[] {
  const types = new Set<string>()
  for (const row of rows) {
    for (const tag of row.tags) {
      const parsed = parseTag(tag)
      if (parsed) types.add(parsed.type)
    }
  }
  return [...types].sort()
}
