import type { DayTotal } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { buildCalendarOption, resolveRange, today } from './CalendarCard.tsx'

/**
 * The two things this card decides: which range a chip means, and what a cell is
 * painted. Both are values, so neither needs a calendar rendered to be checked.
 */

type Built = {
  calendar: { range: string[]; top: number; monthLabel: { formatter: (p: unknown) => string } }
  series: Array<{
    type: string
    data: Array<{ value: [string, number]; itemStyle: { color: string } }>
  }>
}

const days = new Map<string, DayTotal>([
  ['2026-03-04', { value: 40_000, count: 1, dominant: 'bike' }],
  ['2026-08-20', { value: 5_000, count: 1, dominant: 'hike' }],
  ['2025-07-01', { value: 90_000, count: 2, dominant: 'bike' }],
])

const build = (over: Partial<Parameters<typeof buildCalendarOption>[1]> = {}) =>
  buildCalendarOption(days, {
    from: '2026-01-01',
    to: '2026-09-01',
    metric: 'distance',
    cuts: [10_000, 30_000, 60_000],
    splitBy: null,
    colour: (value) => (value === 'bike' ? '#0a6b48' : '#ce7a0c'),
    yearMarks: false,
    ...over,
  }) as unknown as Built

describe('the calendar range', () => {
  const years = [2023, 2025, 2026]

  it('opens on the year in progress when the rows reach it', () => {
    expect(resolveRange(null, years, '2026-09-01')).toEqual({
      range: 'ytd',
      from: '2026-01-01',
      // Stops at today rather than at new year's eve: four empty months drawn after
      // the last possible activity is a chart of the future.
      to: '2026-09-01',
    })
  })

  it('opens on the most recent year the rows do reach, when they stop short', () => {
    expect(resolveRange(null, [2023, 2024], '2026-09-01')).toMatchObject({
      range: '2024',
      from: '2024-01-01',
      to: '2024-12-31',
    })
  })

  it('runs All from the first year to today, unbroken', () => {
    expect(resolveRange('all', years, '2026-09-01')).toEqual({
      range: 'all',
      from: '2023-01-01',
      to: '2026-09-01',
    })
  })

  it('reads today as a local date, not a UTC instant', () => {
    // 23:30 on the 31st is still the 31st here, where `toISOString` would say the 1st.
    expect(today(new Date(2026, 7, 31, 23, 30))).toBe('2026-08-31')
  })
})

describe('the calendar option', () => {
  it('draws with scatter, which a heatmap could not do without a visualMap', () => {
    // The cells are coloured per day — from the ramp, or from the palette slot a tag
    // value owns — and a heatmap series throws rather than accept that.
    expect(build().series[0]!.type).toBe('scatter')
  })

  it('draws only the days inside the range it was given', () => {
    const dates = build().series[0]!.data.map((cell) => cell.value[0])

    // 2025 is in the map — the ramp is cut over everything in scope — but not in this
    // year's grid.
    expect(dates).toEqual(['2026-03-04', '2026-08-20'])
  })

  it('paints a day by which step of the ramp it lands on', () => {
    const [big, small] = build().series[0]!.data

    // 40 km is over the second cut and under the third; 5 km is under the first.
    expect(big?.itemStyle.color).toBe('#5fb790')
    expect(small?.itemStyle.color).toBe('#e7ebe7')
  })

  it('paints by the day’s dominant value when a type is being coloured by', () => {
    const [big, small] = build({ splitBy: 'sport' }).series[0]!.data

    expect(big?.itemStyle.color).toBe('#0a6b48')
    expect(small?.itemStyle.color).toBe('#ce7a0c')
  })

  it('marks the year at each January, and only on the strip', () => {
    const marked = build({ yearMarks: true }).calendar.monthLabel.formatter
    expect(marked({ MM: '01', yyyy: '2025', nameMap: 'Jan' })).toBe('{year|2025}')
    expect(marked({ MM: '04', yyyy: '2025', nameMap: 'Apr' })).toBe('Apr')

    // A single year needs none: the chip that selected it already says which.
    const plain = build().calendar.monthLabel.formatter
    expect(plain({ MM: '01', yyyy: '2026', nameMap: 'Jan' })).toBe('Jan')
  })
})
