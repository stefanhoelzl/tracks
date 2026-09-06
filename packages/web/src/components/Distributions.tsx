import type { ActivityRow, BandKey, Bands } from '@tracks/core'
import { BANDS, bands } from '@tracks/core'
import { useMemo } from 'react'
import { CHART } from '../lib/chart-theme.ts'
import { BAND_UNITS, bandLabel } from '../lib/metrics.ts'
import styles from './Distributions.module.css'
import { Card } from './ui/Card.tsx'
import { Chart, type ChartOption } from './ui/Chart.tsx'

/**
 * Four distributions, and no control over which.
 *
 * The sidebar draws these same four as equal-width histograms with handles on them,
 * and the difference is the whole reason this card exists: those are a shape to cut,
 * these are a table to read. So the bands here are hand-picked and uneven — 0–5,
 * 5–15, 15–30 is how a ride is talked about — and every bar carries its count, which
 * a draggable histogram cannot.
 *
 * All four at once rather than one with a selector: together they answer "what kind
 * of riding is this filter", and a selector would make that four clicks.
 */

const KEYS = Object.keys(BANDS) as BandKey[]

export function buildBandOption(data: Bands, key: BandKey): ChartOption {
  const labels = data.edges.map((edge) => bandLabel(edge, key))

  return {
    grid: { left: 2, right: 2, top: 18, bottom: 2, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART.muted } },
      axisLabel: { color: CHART.muted, interval: 0 },
    },
    // No axis: the number is on the bar, which is the point of a readout.
    yAxis: { type: 'value', show: true, splitLine: { show: false }, axisLabel: { show: false } },
    series: [
      {
        type: 'bar' as const,
        data: data.counts,
        barMaxWidth: 44,
        itemStyle: { color: CHART.bar, borderRadius: 3 },
        label: {
          show: true,
          position: 'top' as const,
          color: CHART.ink,
          fontWeight: 'bold' as const,
          fontSize: 10,
          // A band nothing landed in says nothing rather than saying zero.
          formatter: (params: { value: unknown }) =>
            params.value === 0 ? '' : String(params.value),
        },
      },
    ],
  }
}

export function Distributions({
  rows,
  onBand,
}: {
  rows: ActivityRow[]
  /** Clicking a band filters to it. The open-ended one has no upper bound. */
  onBand: (key: BandKey, min: number, max: number | null) => void
}) {
  const computed = useMemo(() => KEYS.map((key) => ({ key, data: bands(rows, key) })), [rows])

  return (
    <Card
      title="Distributions"
      note={`activities per band${
        computed.some(({ data }) => data.missing > 0)
          ? ` · ${computed
              .filter(({ data }) => data.missing > 0)
              .map(
                ({ key, data }) => `${data.missing} without ${BAND_UNITS[key].label.toLowerCase()}`,
              )
              .join(', ')}`
          : ''
      }`}
    >
      <div className={styles.grid}>
        {computed.map(({ key, data }) => (
          <div key={key} className={styles.cell}>
            <div className={styles.label}>
              {BAND_UNITS[key].label}
              {BAND_UNITS[key].unit ? ` · ${BAND_UNITS[key].unit}` : ''}
            </div>
            <Chart
              option={buildBandOption(data, key)}
              height={120}
              onEvent={{
                click: (params) => {
                  const edge = data.edges[params.dataIndex]
                  if (edge) onBand(key, edge.min, edge.max)
                },
              }}
            />
          </div>
        ))}
      </div>
    </Card>
  )
}
