import type { ActivityTrack } from '@tracks/core'
import type { EChartsType, ElementEvent } from 'echarts/core'
import { useEffect, useMemo, useRef } from 'react'
import { CHART } from '../lib/chart-theme.ts'
import { km, metres } from '../lib/format.ts'
import { cumulativeDistances, indexAtDistance } from '../lib/geo.ts'
import styles from './ElevationProfile.module.css'
import { Chart, type ChartOption } from './ui/Chart.tsx'

/**
 * One activity's terrain, against distance along it.
 *
 * Distance and not time: timestamps were taken off the detail payload deliberately,
 * and nothing since has wanted them back. Distance is also how the thing is talked
 * about — the wall at km 62 — and it is the axis the Distance tile above already
 * agrees with, because `cumulativeDistances` scales it to.
 *
 * Neutral ink rather than the activity's own hashed colour. That colour means *which
 * category is this*, and a profile of a single ride is not answering that; borrowing
 * it would put a mark in the legend that stands for nothing the legend describes.
 */

/**
 * The smallest range the y axis will show.
 *
 * Without it every ride fills the box and a flat valley loop draws exactly like a col.
 * The floor extends upward from the true minimum rather than padding both ends, so the
 * bottom label is always a height that was actually recorded.
 */
const MIN_SPAN_M = 200

/** Enough for the y labels, which are the widest thing outside the plot. */
const GRID = { left: 34, right: 8, top: 8, bottom: 6 }

export interface Profile {
  /** Metres along the track at each point, scaled to the reported distance. */
  distances: number[]
  altitudeM: Array<number | null>
  /** The whole track's length, which is the last distance. */
  totalM: number
}

/**
 * Nothing to draw, as a value rather than as a special case scattered through the
 * component: too few points to make a line, or no altitude on any of them.
 */
export function profileOf(track: ActivityTrack, reportedM: number | null): Profile | null {
  const measured = track.altitudeM.filter((value) => value !== null).length
  if (measured < 2) return null

  const distances = cumulativeDistances(track.coordinates, reportedM)
  const totalM = distances[distances.length - 1] ?? 0
  if (totalM <= 0) return null

  return { distances, altitudeM: track.altitudeM, totalM }
}

export function buildProfileOption({ distances, altitudeM, totalM }: Profile): ChartOption {
  const measured = altitudeM.filter((value): value is number => value !== null)
  const floor = Math.floor(Math.min(...measured))
  const ceiling = Math.ceil(Math.max(...measured))
  const top = floor + Math.max(ceiling - floor, MIN_SPAN_M)

  return {
    grid: GRID,
    xAxis: {
      type: 'value',
      min: 0,
      max: totalM,
      // The two ends are set below the chart, in the same mono row the range sliders
      // use for theirs. An axis label centred on the last tick would hang half its
      // width past the panel.
      show: false,
    },
    yAxis: {
      type: 'value',
      min: floor,
      max: top,
      // One interval, so exactly two labels are drawn: the bottom of the track and
      // the top of the axis. Anything between them is a gridline nobody reads.
      interval: top - floor,
      axisLabel: { color: CHART.muted, formatter: (value: number) => metres(value) },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: CHART.tip,
      borderWidth: 0,
      padding: [4, 8],
      textStyle: { color: CHART.tipInk, fontSize: 10 },
      axisPointer: { type: 'line', lineStyle: { color: CHART.muted, width: 1 } },
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params
        const value = (first as { value?: [number, number | null] } | undefined)?.value
        if (!value) return ''
        const [distance, altitude] = value
        if (altitude === null || altitude === undefined) return `km ${km(distance)}`
        return `km ${km(distance)} · ${metres(altitude)} m`
      },
    },
    series: [
      {
        type: 'line',
        data: distances.map((distance, index) => [distance, altitudeM[index] ?? null]),
        // Rendering only: the series keeps all 34k points, so a hover still names the
        // point it is actually over and the map marker lands on the real coordinate.
        sampling: 'lttb',
        // A dropout is drawn as a dropout. The nulls survived the wire on purpose.
        connectNulls: false,
        showSymbol: false,
        lineStyle: { color: CHART.ink, width: 1.2 },
        // Filled to the start of the axis, not to zero — the axis starts at the
        // track's own minimum, and an area hanging below it would be inventing ground.
        areaStyle: { color: CHART.fill, origin: 'start' },
        emphasis: { disabled: true },
      },
    ],
  }
}

export function ElevationProfile({
  profile,
  cursor,
  onCursor,
  height = 96,
}: {
  profile: Profile
  /** The point the pointer is on, wherever it came from. */
  cursor: number | null
  onCursor: (index: number | null) => void
  height?: number
}) {
  const chart = useRef<EChartsType | null>(null)
  const option = useMemo(() => buildProfileOption(profile), [profile])

  // Attached once, when the instance exists, and read live — so the handler always
  // measures against the track currently loaded rather than the one it was born with.
  const live = useRef({ profile, onCursor })
  live.current = { profile, onCursor }

  /**
   * The chart half of the cursor.
   *
   * Read off zrender and converted back into data space rather than taken from
   * `updateAxisPointer`, because this has to answer with *our* index into the track:
   * the same number the map marker is placed from and the same number the map hands
   * back the other way. One index, one meaning, whichever end moved.
   */
  const attach = (instance: EChartsType) => {
    chart.current = instance
    const zr = instance.getZr()

    zr.on('mousemove', (event: ElementEvent) => {
      const point: [number, number] = [event.offsetX, event.offsetY]
      if (!instance.containPixel({ gridIndex: 0 }, point)) {
        live.current.onCursor(null)
        return
      }
      const [distance] = instance.convertFromPixel({ gridIndex: 0 }, point) as [number, number]
      live.current.onCursor(indexAtDistance(live.current.profile.distances, distance))
    })

    zr.on('globalout', () => live.current.onCursor(null))
  }

  // And the other half: a cursor that arrived from the map moves the tooltip here.
  // Dispatching one the chart itself just produced is a no-op it is not worth a flag
  // to avoid.
  useEffect(() => {
    if (!chart.current) return
    if (cursor === null) chart.current.dispatchAction({ type: 'hideTip' })
    else chart.current.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: cursor })
  }, [cursor])

  return (
    <>
      <Chart option={option} height={height} onInit={attach} />
      <div className={styles.bounds}>
        <span>0</span>
        <span>{km(profile.totalM)} km</span>
      </div>
    </>
  )
}
