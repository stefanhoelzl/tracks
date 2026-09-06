import type { ActivityRow, Metric } from '@tracks/core'
import { activeYears, dayTotals, rampCuts, rampStep } from '@tracks/core'
import { useMemo } from 'react'
import { CHART } from '../lib/chart-theme.ts'
import { type ColourScale, neutralColour } from '../lib/colour.ts'
import { METRIC_UNITS } from '../lib/metrics.ts'
import styles from './CalendarCard.module.css'
import { Card } from './ui/Card.tsx'
import { Chart, type ChartOption } from './ui/Chart.tsx'

/**
 * The calendar: a day per cell, weeks down the columns.
 *
 * One control, and the range it picks also picks the shape. A year — or *YTD*, which
 * is this year without the empty months a full grid would draw after today — is one
 * row of weeks. *All* carries that row on unbroken from the first activity to the
 * last, which is what an archive actually is, and scrolls sideways rather than being
 * cut into a stack of years.
 *
 * There is no chip for the current year, because YTD is it.
 */

/** Four steps and a rest, which is a legend you can read rather than a gradient. */
const RAMP = ['#e7ebe7', '#b6e0cc', '#5fb790', '#0d8a5f']
const RESTING = '#eef1ee'

/** A cell and its gutter. Wide enough to hit, narrow enough for six years of them. */
const CELL = 14

/** The mark inside a cell, leaving the gutter the calendar's own grid draws. */
const MARK = CELL - 3

export type CalendarRange = 'ytd' | 'all' | string

/** Today, as a local date — the app's dates are local, so this one is too. */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/**
 * The range a chip means, resolved against the rows.
 *
 * `null` picks: YTD when the rows reach this year, else the most recent year they do.
 * A default that depends on the data cannot be written into the URL, so it is computed
 * where the data is.
 */
export function resolveRange(
  range: CalendarRange | null,
  years: number[],
  now: string,
): { range: CalendarRange; from: string; to: string } {
  const thisYear = Number(now.slice(0, 4))
  const chosen = range ?? (years.includes(thisYear) ? 'ytd' : String(years.at(-1) ?? thisYear))

  if (chosen === 'all') {
    return { range: chosen, from: `${years[0] ?? thisYear}-01-01`, to: now }
  }
  if (chosen === 'ytd') return { range: chosen, from: `${thisYear}-01-01`, to: now }
  return { range: chosen, from: `${chosen}-01-01`, to: `${chosen}-12-31` }
}

export function buildCalendarOption(
  days: ReadonlyMap<string, { value: number; count: number; dominant: string | null }>,
  options: {
    from: string
    to: string
    metric: Metric
    cuts: readonly [number, number, number]
    /** Null when colouring by intensity; otherwise the type each day is dominated by. */
    splitBy: string | null
    colour: (value: string | null) => string
    yearMarks: boolean
  },
): ChartOption {
  const { from, to, metric, cuts, splitBy, colour, yearMarks } = options
  const units = METRIC_UNITS[metric]

  const data = [...days.entries()]
    .filter(([date]) => date >= from && date <= to)
    .map(([date, day]) => ({
      value: [date, day.value] as [string, number],
      itemStyle: {
        color: splitBy === null ? RAMP[rampStep(day.value, cuts)] : colour(day.dominant),
      },
    }))

  return {
    tooltip: {
      backgroundColor: CHART.tip,
      borderWidth: 0,
      textStyle: { color: CHART.tipInk, fontSize: 11 },
      formatter: (params: unknown) => {
        const [date] = (params as { value: [string, number] }).value
        const day = days.get(date)
        if (!day) return date
        const dominant = splitBy === null || day.dominant === null ? '' : `<br/>${day.dominant}`
        return `${date}<br/>${units.tip(day.value)} · ${day.count} activit${day.count === 1 ? 'y' : 'ies'}${dominant}`
      },
    },
    calendar: {
      top: yearMarks ? 34 : 22,
      left: 8,
      right: 8,
      bottom: 8,
      cellSize: [CELL, CELL],
      range: [from, to],
      // Monday, like `weekStart` and like ISO — a week that starts on Sunday would
      // put the same activity in a different column from the trend's week bucket.
      dayLabel: { show: false, firstDay: 1 },
      monthLabel: {
        color: CHART.muted,
        fontSize: 9,
        // The year, only where it changes: on a strip six years long, month names
        // alone leave you unable to say where you are.
        formatter: (params: { nameMap: string; yyyy: string; MM: string }) =>
          yearMarks && params.MM === '01' ? `{year|${params.yyyy}}` : params.nameMap,
        rich: { year: { color: CHART.ink, fontWeight: 'bold' as const, fontSize: 10 } },
      },
      yearLabel: { show: false },
      splitLine: { show: false },
      itemStyle: { color: RESTING, borderWidth: 3, borderColor: '#fff' },
    },
    series: [
      {
        // Scatter, not heatmap: a heatmap series throws without a `visualMap`, and
        // these cells are coloured per day — by the ramp, or by the palette slot the
        // dominant tag value already owns — rather than by a scale ECharts derives.
        type: 'scatter' as const,
        coordinateSystem: 'calendar' as const,
        symbol: 'roundRect' as const,
        symbolSize: MARK,
        data,
      },
    ],
  }
}

export function CalendarCard({
  rows,
  metric,
  range,
  colourBy,
  scale,
  onRange,
  onColour,
  onDate,
}: {
  rows: ActivityRow[]
  metric: Metric
  range: CalendarRange | null
  /** Null colours by intensity; a type name colours by the day's dominant value. */
  colourBy: string | null
  scale: ColourScale
  onRange: (range: CalendarRange) => void
  onColour: (colour: string | null) => void
  onDate: (date: string) => void
}) {
  const now = today()
  const years = useMemo(() => activeYears(rows), [rows])
  const resolved = useMemo(() => resolveRange(range, years, now), [range, years, now])

  const days = useMemo(() => dayTotals(rows, metric, colourBy), [rows, metric, colourBy])
  // Cut over everything in scope rather than over the range on screen, so a shade
  // means the same thing whichever year you are looking at.
  const cuts = useMemo(() => rampCuts(days), [days])

  const option = useMemo(
    () =>
      buildCalendarOption(days, {
        from: resolved.from,
        to: resolved.to,
        metric,
        cuts,
        splitBy: colourBy,
        colour: (value) =>
          value === null || colourBy === null ? neutralColour() : scale.colour(colourBy, value),
        yearMarks: resolved.range === 'all',
      }),
    [days, resolved, metric, cuts, colourBy, scale],
  )

  const types = useMemo(
    () =>
      [
        ...new Set(rows.flatMap((row) => row.tags.map((tag) => tag.slice(0, tag.indexOf(':'))))),
      ].sort(),
    [rows],
  )

  const thisYear = Number(now.slice(0, 4))
  const chips: CalendarRange[] = [
    ...years.filter((year) => year !== thisYear).map(String),
    ...(years.includes(thisYear) ? (['ytd'] as const) : []),
    'all',
  ]

  const weeks = Math.ceil(
    (Date.parse(`${resolved.to}T00:00:00Z`) - Date.parse(`${resolved.from}T00:00:00Z`)) /
      (7 * 86_400_000),
  )

  return (
    <Card
      title="Calendar"
      controls={
        <select
          className={styles.colour}
          aria-label="Colour"
          value={colourBy ?? 'ramp'}
          onChange={(event) => onColour(event.target.value === 'ramp' ? null : event.target.value)}
        >
          {/* Two sections, because they are two different readings: how much, or of
              what. Picking a type sets the app-wide colour by, so the map agrees. */}
          <optgroup label="Intensity">
            <option value="ramp">{METRIC_UNITS[metric].label}, in four steps</option>
          </optgroup>
          <optgroup label="Dominant tag">
            {types.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </optgroup>
        </select>
      }
      note={`${days.size} active days`}
    >
      <div className={resolved.range === 'all' ? styles.strip : undefined}>
        <div style={{ width: resolved.range === 'all' ? weeks * (CELL + 3) + 40 : undefined }}>
          <Chart
            option={option}
            height={resolved.range === 'all' ? 150 : 140}
            onEvent={{
              click: (params) => {
                const value = (params.data as { value?: [string, number] } | undefined)?.value
                if (value) onDate(value[0])
              },
            }}
          />
        </div>
      </div>

      <div className={styles.foot}>
        {colourBy === null ? (
          <div className={styles.legend}>
            <span className={styles.key}>
              <span className={styles.swatch} style={{ background: RESTING }} />
              rest
            </span>
            {RAMP.map((colour, step) => (
              <span key={colour} className={styles.key}>
                <span className={styles.swatch} style={{ background: colour }} />
                {step === RAMP.length - 1
                  ? `> ${METRIC_UNITS[metric].axis(cuts[2])}`
                  : `≤ ${METRIC_UNITS[metric].axis(cuts[step] ?? 0)}`}
              </span>
            ))}
          </div>
        ) : (
          <div className={styles.legend}>
            <span className={styles.key}>coloured by the day’s dominant {colourBy}</span>
          </div>
        )}

        <div className={styles.chips}>
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              className={[styles.chip, chip === resolved.range ? styles.chipOn : ''].join(' ')}
              aria-pressed={chip === resolved.range}
              onClick={() => onRange(chip)}
            >
              {chip === 'ytd' ? 'YTD' : chip === 'all' ? 'All' : chip}
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}
