import { useMemo } from 'react'
import { CHART } from '../../lib/chart-theme.ts'
import { Chart, type ChartOption } from './Chart.tsx'
import styles from './Histogram.module.css'

/**
 * The distribution a range is chosen on.
 *
 * Bars are the counts under the self-excluded filter, so the shape responds to every
 * other facet while the axis under it stays still. It draws and nothing else: the
 * handles that sit over it are native inputs, and this chart never sees a pointer.
 */

export interface HistogramBounds {
  axisMin: number
  axisMax: number
  /** The selected range, already resolved — an unbounded end is its axis end. */
  low: number
  high: number
}

/**
 * The option, as a value.
 *
 * Buckets are equal-width over `[axisMin, axisMax]`, so a bar is plotted at its
 * bucket's centre on a *value* axis rather than as a category. That is what lets the
 * dimming below be exact: a category axis can only be cut between bars, and a handle
 * is under no obligation to stop there.
 */
export function buildHistogramOption(
  buckets: readonly number[],
  { axisMin, axisMax, low, high }: HistogramBounds,
): ChartOption {
  const width = (axisMax - axisMin) / Math.max(buckets.length, 1)
  const centre = (index: number) => axisMin + (index + 0.5) * width

  // Only the ends that are actually narrowed. A zero-width band is a hairline of
  // paint at a bound nobody set.
  const outside: Array<[{ xAxis: number }, { xAxis: number }]> = []
  if (low > axisMin) outside.push([{ xAxis: axisMin }, { xAxis: low }])
  if (high < axisMax) outside.push([{ xAxis: high }, { xAxis: axisMax }])

  return {
    grid: { left: 0, right: 0, top: 2, bottom: 0 },
    xAxis: { type: 'value', min: axisMin, max: axisMax, show: false },
    // Pinned to the tallest bucket so the distribution fills the box; ECharts would
    // otherwise round the top up to a nice number and leave the shape short.
    yAxis: { type: 'value', min: 0, max: Math.max(1, ...buckets), show: false },
    series: [
      {
        type: 'bar',
        silent: true,
        barWidth: '92%',
        data: buckets.map((count, index) => [centre(index), count]),
        itemStyle: { color: CHART.bar, borderRadius: [2, 2, 0, 0] },
        markArea: {
          silent: true,
          // Above the bars, which is the whole point and is not the default: a
          // markArea at its natural depth paints behind the series, where it can tint
          // the gaps between bars but never the bars themselves.
          z: 10,
          itemStyle: { color: CHART.dim },
          data: outside,
        },
      },
    ],
  }
}

export function Histogram({
  buckets,
  height = 38,
  ...bounds
}: HistogramBounds & { buckets: readonly number[]; height?: number }) {
  const { axisMin, axisMax, low, high } = bounds
  const option = useMemo(
    () => buildHistogramOption(buckets, { axisMin, axisMax, low, high }),
    [buckets, axisMin, axisMax, low, high],
  )

  return <Chart option={option} height={height} className={styles.histogram} />
}
