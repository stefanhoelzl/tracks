import type { ActivityRow, Bucket, Metric } from '@tracks/core'
import { BUCKETS, bucketRange, METRICS, trend } from '@tracks/core'
import { useMemo } from 'react'
import { CHART } from '../lib/chart-theme.ts'
import { type ColourScale, neutralColour } from '../lib/colour.ts'
import { METRIC_UNITS } from '../lib/metrics.ts'
import { Card, CardSelect } from './ui/Card.tsx'
import { Chart, type ChartOption } from './ui/Chart.tsx'

/**
 * Volume over time: one stacked bar per bucket, split by the app-wide *colour by*.
 *
 * Two controls, and the stack is not one of them. Which type it splits by is the
 * same choice the map and the list bars are already making, so all three read as one
 * legend — and closing the panel leaves the map coloured the way the chart was. The
 * bucket and the metric are this card's own, because neither has anywhere else to be
 * asked.
 */

/** Empty buckets keep their slot and draw a stub, because a gap is data. */
const STUB = 3

export function buildTrendOption(
  data: ReturnType<typeof trend>,
  options: {
    metric: Metric
    splitBy: string | null
    colour: (value: string | null) => string
    labelEvery: (key: string, index: number) => boolean
  },
): ChartOption {
  const { metric, splitBy, colour, labelEvery } = options
  const { keys, series, totals, counts } = data
  const units = METRIC_UNITS[metric]

  return {
    grid: { left: 4, right: 4, top: 18, bottom: 22, containLabel: true },
    xAxis: {
      type: 'category',
      data: keys,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART.muted } },
      axisLabel: {
        color: CHART.muted,
        interval: (index: number, key: string) => labelEvery(key, index),
        formatter: (key: string) => key.slice(0, 4),
      },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: 'rgba(15, 21, 19, 0.06)' } },
      axisLabel: { color: CHART.muted, formatter: (value: number) => units.axis(value) },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART.tip,
      borderWidth: 0,
      textStyle: { color: CHART.tipInk, fontSize: 11 },
      // Written here rather than through ECharts' template syntax: the total and the
      // activity count are not series, and a formatter is the only place they can be
      // said alongside the bands.
      // `unknown` in, like the profile's: ECharts types this parameter as a union of
      // every trigger's shape, and narrowing it here is cheaper than proving which.
      formatter: (params: unknown) => {
        const bands = (Array.isArray(params) ? params : [params]) as Array<{
          dataIndex: number
          seriesName: string
          value: number
        }>
        const at = bands[0]?.dataIndex ?? 0
        const head = `${keys[at]}<br/>${units.tip(totals[at] ?? 0)} · ${counts[at] ?? 0} activities`
        if (splitBy === null) return head

        const split = bands
          .filter((band) => band.value > 0 && band.seriesName !== 'empty')
          .map((band) => `${band.seriesName}&nbsp;&nbsp;${units.tip(band.value)}`)
        return split.length > 1 ? [head, ...split].join('<br/>') : head
      },
    },
    series: [
      ...series.map((band) => ({
        type: 'bar' as const,
        name: band.value ?? 'not set',
        stack: 'volume',
        data: band.values,
        barMaxWidth: 26,
        itemStyle: { color: colour(band.value), borderRadius: 2 },
      })),
      // A second series drawn under the stack, one stub high wherever the bucket is
      // empty. A bar of zero draws nothing, and nothing is indistinguishable from a
      // bucket that fell off the end.
      {
        type: 'bar' as const,
        name: 'empty',
        stack: 'volume',
        silent: true,
        data: totals.map((total) => (total === 0 ? STUB : 0)),
        barMaxWidth: 26,
        itemStyle: { color: 'rgba(15, 21, 19, 0.12)', borderRadius: 2 },
        tooltip: { show: false },
      },
    ],
  }
}

export function VolumeTrend({
  rows,
  bucket,
  metric,
  splitBy,
  scale,
  onBucket,
  onMetric,
  onRange,
}: {
  rows: ActivityRow[]
  bucket: Bucket
  metric: Metric
  splitBy: string | null
  scale: ColourScale
  onBucket: (bucket: Bucket) => void
  onMetric: (metric: Metric) => void
  /** Clicking a bar filters to the dates it covers. */
  onRange: (from: string, to: string) => void
}) {
  const data = useMemo(
    () => trend(rows, { bucket, metric, splitBy }),
    [rows, bucket, metric, splitBy],
  )

  const option = useMemo(
    () =>
      buildTrendOption(data, {
        metric,
        splitBy,
        colour: (value) =>
          value === null || splitBy === null ? neutralColour() : scale.colour(splitBy, value),
        // A year's worth of weeks is too many labels for the width, so only the first
        // bucket of a year is named — and it is named by its year.
        labelEvery: (key, index) =>
          index === 0 || (bucket === 'year' ? true : key.slice(5) <= '01-07'),
      }),
    [data, metric, splitBy, scale, bucket],
  )

  return (
    <Card
      title="Volume by"
      controls={
        <>
          <CardSelect label="Bucket" value={bucket} options={BUCKETS} onChange={onBucket} />
          <CardSelect label="Metric" value={metric} options={METRICS} onChange={onMetric} />
        </>
      }
      note={splitBy === null ? 'not split' : `stacked by ${splitBy}`}
    >
      <Chart
        option={option}
        height={200}
        onEvent={{
          click: (params) => {
            const key = data.keys[params.dataIndex]
            if (key === undefined) return
            const { from, to } = bucketRange(key, bucket)
            onRange(from, to)
          },
        }}
      />
    </Card>
  )
}
