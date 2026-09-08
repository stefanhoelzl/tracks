import type { ActivityTrack } from '@tracks/core'
import type { EChartsType, ElementEvent } from 'echarts/core'
import { useEffect, useMemo, useRef } from 'react'
import { CHART, gradeColour } from '../lib/chart-theme.ts'
import { km, metres, slope } from '../lib/format.ts'
import { cumulativeDistances, drawnIndices, gradients, nearestInSorted } from '../lib/geo.ts'
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
 * Coloured by gradient, on the absolute ramp `GRADE` defines: dark green through light
 * green, yellow, orange and red to dark red at +15%. Still deliberately not the
 * activity's hashed colour — that colour answers *which category*, where this answers
 * *how steep, here*, which is the question a single ride's profile is for.
 */

/**
 * The smallest range the y axis will show.
 *
 * Without it every ride fills the box and a flat valley loop draws exactly like a col.
 * The floor extends upward from the true minimum rather than padding both ends, so the
 * bottom label is always a height that was actually recorded.
 */
const MIN_SPAN_M = 200

/**
 * How much relief simplification may discard, as a floor and as a share of the track's
 * own range.
 *
 * The share keeps the tolerance sub-pixel — a 96 px box divided 400 ways — so nothing
 * you could see is ever dropped, whatever the terrain. The floor stops it falling below
 * what a barometric altimeter can resolve, so on a flat ride it does not spend points
 * preserving noise. Most activities sit on the floor; only genuinely mountainous ones
 * rise off it.
 */
const MIN_TOLERANCE_M = 1
const TOLERANCE_OF_SPAN = 1 / 400

/**
 * The furthest apart two drawn points may be — which is the cursor's resolution, and
 * nothing else: the shape is entirely the tolerance's business.
 *
 * Fixed at 50 m for anything over 2 km, so a metre on screen means the same on the
 * ground whichever activity is open. Below that it shrinks, because 50 m of a 500 m
 * walk is a tenth of it and the snap would be visible.
 */
const MAX_STEP_M = 50
const MIN_STEPS = 40

/** Enough for the y labels, which are the widest thing outside the plot. */
const GRID = { left: 34, right: 8, top: 8, bottom: 6 }

/** The area under the line, against the line's own colour at full strength. */
const AREA_OPACITY = 0.16

export interface Profile {
  /** Metres along the track at each drawn point, scaled to the reported distance. */
  distances: number[]
  altitudeM: Array<number | null>
  /** Percent at each drawn point; null where the window had nothing to measure. */
  gradients: Array<number | null>
  /** Each drawn point's index into the track, which is what the map is hovering. */
  trackIndex: number[]
  /** The whole track's length, which is the last distance. */
  totalM: number
}

/**
 * Nothing to draw, as a value rather than as a special case scattered through the
 * component: too few points to make a line, or no altitude on any of them.
 */
export function profileOf(track: ActivityTrack, reportedM: number | null): Profile | null {
  let lowest = Number.POSITIVE_INFINITY
  let highest = Number.NEGATIVE_INFINITY
  let count = 0
  for (const value of track.altitudeM) {
    if (value === null) continue
    if (value < lowest) lowest = value
    if (value > highest) highest = value
    count++
  }
  if (count < 2) return null

  const distances = cumulativeDistances(track.coordinates, reportedM)
  const totalM = distances[distances.length - 1] ?? 0
  if (totalM <= 0) return null

  // The track's own relief, not the axis's. `MIN_SPAN_M` is a floor on what the box
  // shows, and letting it set the tolerance would flatten the one kind of ride whose
  // relief is small enough to matter.
  const tolerance = Math.max(MIN_TOLERANCE_M, (highest - lowest) * TOLERANCE_OF_SPAN)
  const measured = gradients(distances, track.altitudeM)
  const trackIndex = drawnIndices(
    distances,
    track.altitudeM,
    tolerance,
    Math.min(MAX_STEP_M, totalM / MIN_STEPS),
  )

  if (trackIndex.filter((at) => track.altitudeM[at] !== null).length < 2) return null

  return {
    distances: trackIndex.map((at) => distances[at]!),
    altitudeM: trackIndex.map((at) => track.altitudeM[at] ?? null),
    gradients: trackIndex.map((at) => measured[at] ?? null),
    trackIndex,
    totalM,
  }
}

/**
 * The ramp, as one gradient laid along the x axis.
 *
 * ECharts will not colour a line from a `visualMap` on anything but an axis dimension —
 * it wants to build a gradient out of it, and can only place the stops if it knows
 * where they fall on a coordinate. So the gradient is built here instead, from the one
 * dimension that *is* on an axis: distance. Same thing, one step earlier, and it costs
 * one SVG path rather than one per segment.
 *
 * Offsets are fractions of the drawn line's own bounding box, which is what a
 * non-global gradient is measured against — so they run between the first and last
 * point that carries an altitude, not between 0 and the track's length. A track that
 * starts under a dropout would otherwise be painted with the ramp shifted along it.
 *
 * A run of one colour keeps only the stops at its two ends. Dropping the ends instead
 * would smear a plateau into whatever is next to it.
 */
function rampAlong({ distances, altitudeM, gradients: grades }: Profile) {
  const drawn: number[] = []
  for (let at = 0; at < distances.length; at++) if (altitudeM[at] !== null) drawn.push(at)
  if (drawn.length === 0) return CHART.ink

  const first = distances[drawn[0]!]!
  const span = distances[drawn[drawn.length - 1]!]! - first
  if (span <= 0) return CHART.ink

  const colours = drawn.map((at) => {
    const gradient = grades[at]
    return gradient === null || gradient === undefined ? CHART.ink : gradeColour(gradient)
  })

  const colorStops: Array<{ offset: number; color: string }> = []
  for (let k = 0; k < colours.length; k++) {
    const colour = colours[k]!
    const plateau =
      k > 0 && k < colours.length - 1 && colour === colours[k - 1] && colour === colours[k + 1]
    if (plateau) continue
    colorStops.push({ offset: (distances[drawn[k]!]! - first) / span, color: colour })
  }

  return { type: 'linear' as const, x: 0, y: 0, x2: 1, y2: 0, colorStops }
}

export function buildProfileOption(profile: Profile): ChartOption {
  const { distances, altitudeM, gradients: grades, totalM } = profile
  const measured = altitudeM.filter((value): value is number => value !== null)
  const floor = Math.floor(Math.min(...measured))
  const ceiling = Math.ceil(Math.max(...measured))
  const top = floor + Math.max(ceiling - floor, MIN_SPAN_M)

  // One paint for the line and the area beneath it, so the profile reads as a coloured
  // mass rather than as a coloured hairline over a grey one.
  const paint = rampAlong(profile)

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
        const value = (first as { value?: [number, number | null, number | null] } | undefined)
          ?.value
        if (!value) return ''
        const [distance, altitude, gradient] = value
        if (altitude === null || altitude === undefined) return `km ${km(distance)}`

        const readout = `km ${km(distance)} · ${metres(altitude)} m`
        // The figure in the colour the line under the cursor is drawn in: the number
        // and the key to the ramp in one mark, which is why there is no key elsewhere.
        if (gradient === null || gradient === undefined) return readout
        return `${readout} · <span style="color:${gradeColour(gradient)}">${slope(gradient)}%</span>`
      },
    },
    series: [
      {
        type: 'line',
        // The gradient rides along as a third dimension. Nothing plots it — it is what
        // the tooltip reads, so the formatter answers from the datum rather than from a
        // lookup it would have to be handed separately.
        data: distances.map((distance, index) => [
          distance,
          altitudeM[index] ?? null,
          grades[index] ?? null,
        ]),
        // Rendering only: the series keeps every point the profile drew, so a hover
        // still names a point the track recorded, and the map marker lands on a real
        // coordinate.
        sampling: 'lttb',
        // A dropout is drawn as a dropout. The nulls survived the wire on purpose.
        connectNulls: false,
        showSymbol: false,
        lineStyle: { color: paint, width: 1.2 },
        // Filled to the start of the axis, not to zero — the axis starts at the
        // track's own minimum, and an area hanging below it would be inventing ground.
        areaStyle: { color: paint, opacity: AREA_OPACITY, origin: 'start' },
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
   * back the other way. The profile draws a simplification, so the two index spaces
   * differ — but every drawn point is one the track recorded, so the conversion is a lookup
   * and never an interpolation, and it happens here and in the effect below and
   * nowhere else. One index, one meaning, whichever end moved.
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
      const drawn = nearestInSorted(live.current.profile.distances, distance)
      live.current.onCursor(live.current.profile.trackIndex[drawn] ?? null)
    })

    zr.on('globalout', () => live.current.onCursor(null))
  }

  // And the other half: a cursor that arrived from the map moves the tooltip here.
  // Dispatching one the chart itself just produced is a no-op it is not worth a flag
  // to avoid.
  useEffect(() => {
    if (!chart.current) return
    if (cursor === null) chart.current.dispatchAction({ type: 'hideTip' })
    else
      chart.current.dispatchAction({
        type: 'showTip',
        seriesIndex: 0,
        dataIndex: nearestInSorted(profile.trackIndex, cursor),
      })
  }, [cursor, profile])

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
