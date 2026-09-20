import type { ActivityTrack } from '@tracks/core'
import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CHART, gradeColour } from '../lib/chart-theme.ts'
import { km, metres, slope } from '../lib/format.ts'
import { cumulativeDistances, drawnIndices, gradients, nearestInSorted } from '../lib/geo.ts'
import {
  alongAt,
  altitudeAt,
  distanceAxis,
  heightAxis,
  type Stats,
  splitAt,
  statsBetween,
} from '../lib/profile.ts'
import styles from './ElevationProfile.module.css'

/**
 * One track's terrain, against distance along it.
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
 *
 * **Drawn by hand rather than by ECharts.** The same picture has to appear in four
 * places across two platforms, one of which paints it on a Compose canvas; with a chart
 * library on one side only, every gesture and every gridline was a translation between
 * two vocabularies, and the two drifted. So the line, the axes, the bar and the brush
 * are an `<svg>` here and a `Canvas` there, over arithmetic both import from
 * `lib/profile.ts`. ECharts stays where it earns its keep — the analytics charts, which
 * exist here only.
 */

/**
 * The smallest range the y axis will show.
 *
 * Without it every ride fills the box and a flat valley loop draws exactly like a col.
 * It survived the arrival of gridlines and is snapped out to whichever round step the
 * axis chose, so the labels stay numbers you would say out loud.
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

/** Room for the height labels on the left, and for the distance labels underneath. */
const GRID = { left: 38, right: 8, top: 10, bottom: 18 }

/** The area under the line, against the line's own colour at full strength. */
const AREA_OPACITY = 0.16

/** What the line drops to outside a selected stretch. The stretch keeps its own colour. */
const OUTSIDE_OPACITY = 0.28

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
 * A stretch between two bars, in metres along the track — and how long that track is.
 *
 * The length travels with it because whoever draws the stretch on the map has to measure the
 * same coordinates the same way, and the profile scaled its own distances to the reported
 * length. Two numbers and the scale they were taken at, rather than two numbers and a guess.
 */
export interface Range {
  fromM: number
  toM: number
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
 * Built along the one dimension that is on an axis — distance — rather than per segment:
 * it costs one `<linearGradient>` and one path rather than one path per point, and the
 * line and the area beneath it can share the single paint.
 *
 * Offsets are fractions of the drawn line's own extent, so they run between the first
 * and last point that carries an altitude rather than between 0 and the track's length.
 * A track that starts under a dropout would otherwise be painted with the ramp shifted
 * along it. A run of one colour keeps only the stops at its two ends; dropping the ends
 * instead would smear a plateau into whatever is next to it.
 */
export function rampStops({ distances, altitudeM, gradients: grades }: Profile) {
  const drawn: number[] = []
  for (let at = 0; at < distances.length; at++) if (altitudeM[at] !== null) drawn.push(at)
  if (drawn.length === 0) return null

  const first = distances[drawn[0]!]!
  const span = distances[drawn[drawn.length - 1]!]! - first
  if (span <= 0) return null

  const colours = drawn.map((at) => {
    const gradient = grades[at]
    return gradient === null || gradient === undefined ? CHART.ink : gradeColour(gradient)
  })

  const stops: Array<{ offset: number; colour: string }> = []
  for (let k = 0; k < colours.length; k++) {
    const colour = colours[k]!
    const plateau =
      k > 0 && k < colours.length - 1 && colour === colours[k - 1] && colour === colours[k + 1]
    if (plateau) continue
    stops.push({ offset: (distances[drawn[k]!]! - first) / span, colour })
  }
  return { stops, fromM: first, spanM: span }
}

/** One run of measured altitude, as the line's `d` and the area's. */
function runsOf(profile: Profile, x: (m: number) => number, y: (m: number) => number) {
  const { distances, altitudeM } = profile
  const runs: Array<{ line: string; area: string }> = []

  let start = 0
  while (start < altitudeM.length) {
    if (altitudeM[start] === null) {
      start++
      continue
    }
    let end = start
    while (end + 1 < altitudeM.length && altitudeM[end + 1] !== null) end++

    // A single measured point between two dropouts is a dot with no line in it; skipped
    // rather than drawn as a zero-length path, which some renderers cap into a blob.
    if (end > start) {
      const points = []
      for (let at = start; at <= end; at++) {
        points.push(`${x(distances[at]!).toFixed(2)} ${y(altitudeM[at]!).toFixed(2)}`)
      }
      const line = `M${points.join('L')}`
      runs.push({
        line,
        area: `${line}L${x(distances[end]!).toFixed(2)} BASEL${x(distances[start]!).toFixed(2)} BASEZ`,
      })
    }
    start = end + 1
  }
  return runs
}

export function ElevationProfile({
  profile,
  cursor,
  onCursor,
  height = 96,
  /** Where you are on this stretch, when something is riding it. Planning, there is nobody. */
  youM = null,
  /** Without axes it is the line alone, edge to edge: a strip under a line of text. */
  axes = true,
  minSpanM = MIN_SPAN_M,
  onRange,
}: {
  profile: Profile
  /** The point the pointer is on, wherever it came from. */
  cursor: number | null
  onCursor: (index: number | null) => void
  height?: number
  youM?: number | null
  axes?: boolean
  minSpanM?: number
  /** Told which stretch is selected, so the map can dim the rest of the track. */
  onRange?: (range: Range | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  /** The bar you left there, as opposed to the one following the pointer. */
  const [pinned, setPinned] = useState<number | null>(null)
  const [range, setRange] = useState<Range | null>(null)
  /** Where a drag began, while it is still too short to be a brush rather than a click. */
  const drag = useRef<{ fromM: number; moved: boolean } | null>(null)

  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // A new track is a new profile: a bar left on the old one points at a place that is
  // not there any more, and a range would dim a stretch of something else. Watched by the
  // profile alone — a caller that rebuilds its callback has not changed the track.
  const told = useRef(onRange)
  told.current = onRange
  // biome-ignore lint/correctness/useExhaustiveDependencies: the callback is read live, not watched
  useEffect(() => {
    setPinned(null)
    setRange(null)
    told.current?.(null)
  }, [profile])

  const plot = useMemo(() => {
    const measured = profile.altitudeM.filter((value): value is number => value !== null)
    const low = Math.min(...measured)
    const high = Math.max(...measured)
    return {
      y: heightAxis(low, high, minSpanM),
      x: distanceAxis(profile.totalM),
      ramp: rampStops(profile),
    }
  }, [profile, minSpanM])

  const inner = {
    left: axes ? GRID.left : 6,
    right: axes ? GRID.right : 6,
    top: axes ? GRID.top : 3,
    bottom: axes ? GRID.bottom : 3,
  }
  const plotWidth = Math.max(width - inner.left - inner.right, 1)
  const plotHeight = Math.max(height - inner.top - inner.bottom, 1)

  const x = (alongM: number) => inner.left + (alongM / profile.totalM) * plotWidth
  const y = (altitude: number) =>
    inner.top + plotHeight - ((altitude - plot.y.min) / (plot.y.max - plot.y.min)) * plotHeight

  // Recomputed whenever the shape or the box it is drawn in changes: `x` and `y` are
  // rebuilt every render and close over both, so they are not dependencies themselves.
  const runs = runsOf(profile, x, y)

  /** Where a pointer at [clientX] is, in metres along the track. */
  const alongFrom = (clientX: number) => {
    const bounds = box.current?.getBoundingClientRect()
    if (!bounds || plotWidth <= 0) return 0
    return alongAt(profile.totalM, (clientX - bounds.left - inner.left) / plotWidth)
  }

  const report = (alongM: number | null) => {
    if (alongM === null) {
      onCursor(null)
      return
    }
    onCursor(profile.trackIndex[nearestInSorted(profile.distances, alongM)] ?? null)
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { fromM: alongFrom(event.clientX), moved: false }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const alongM = alongFrom(event.clientX)
    const started = drag.current
    if (started) {
      // A brush only once the pointer has gone somewhere: a click that wobbles by a
      // pixel is still a click, and selecting a 3 m stretch of a 40 km ride is never
      // what anyone meant.
      if (!started.moved && Math.abs(x(alongM) - x(started.fromM)) < 4) {
        report(alongM)
        return
      }
      started.moved = true
      const next = {
        fromM: Math.min(started.fromM, alongM),
        toM: Math.max(started.fromM, alongM),
        totalM: profile.totalM,
      }
      setRange(next)
      onRange?.(next)
    }
    report(alongM)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const started = drag.current
    drag.current = null
    if (!started) return
    if (started.moved) return
    // A click pins the bar where it is, and a second click on the same place takes it
    // away again — including the range a drag left behind.
    const alongM = alongFrom(event.clientX)
    if (range) {
      setRange(null)
      onRange?.(null)
    }
    setPinned((was) => (was !== null && Math.abs(x(was) - x(alongM)) < 4 ? null : alongM))
  }

  const onPointerLeave = () => {
    if (drag.current) return
    report(pinned)
  }

  // The other half of the cursor: one that arrived from the map moves the bar here.
  const fromMap =
    cursor === null
      ? null
      : (profile.distances[nearestInSorted(profile.trackIndex, cursor)] ?? null)

  const barM = range ? null : (fromMap ?? pinned)
  const readAt = barM ?? pinned
  const altitude = readAt === null ? null : altitudeAt(profile.distances, profile.altitudeM, readAt)
  const gradient =
    readAt === null ? null : (profile.gradients[nearestInSorted(profile.distances, readAt)] ?? null)

  // Riding, the flanking figures are measured from you; planning, from the bar. Same
  // arithmetic, and "done" is true either way.
  const splitM = youM ?? readAt
  const split = useMemo(
    () => (splitM === null ? null : splitAt(profile.distances, profile.altitudeM, splitM)),
    [profile, splitM],
  )
  const selected = useMemo(
    () =>
      range ? statsBetween(profile.distances, profile.altitudeM, range.fromM, range.toM) : null,
    [profile, range],
  )

  const rampId = useMemo(() => `ramp-${Math.random().toString(36).slice(2, 9)}`, [])
  const clipId = `${rampId}-band`
  const base = (inner.top + plotHeight).toFixed(2)

  return (
    <>
      <div
        ref={box}
        className={styles.plot}
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        {width > 0 ? (
          <svg width={width} height={height} aria-hidden="true">
            <defs>
              {plot.ramp ? (
                <linearGradient
                  id={rampId}
                  gradientUnits="userSpaceOnUse"
                  x1={x(plot.ramp.fromM)}
                  x2={x(plot.ramp.fromM + plot.ramp.spanM)}
                >
                  {plot.ramp.stops.map((stop) => (
                    <stop
                      key={`${stop.offset}-${stop.colour}`}
                      offset={`${(stop.offset * 100).toFixed(3)}%`}
                      stopColor={stop.colour}
                    />
                  ))}
                </linearGradient>
              ) : null}
              {range ? (
                <clipPath id={clipId}>
                  <rect
                    x={x(range.fromM)}
                    y={inner.top}
                    width={Math.max(x(range.toM) - x(range.fromM), 0)}
                    height={plotHeight}
                  />
                </clipPath>
              ) : null}
            </defs>

            {axes
              ? plot.y.values.map((value) => (
                  <g key={value}>
                    <line
                      className={styles.gridline}
                      x1={inner.left}
                      x2={inner.left + plotWidth}
                      y1={y(value)}
                      y2={y(value)}
                    />
                    <text
                      className={styles.axisLabel}
                      x={inner.left - 7}
                      y={y(value) + 3.5}
                      textAnchor="end"
                    >
                      {metres(value)}
                    </text>
                  </g>
                ))
              : null}

            {range ? (
              <rect
                className={styles.band}
                x={x(range.fromM)}
                y={inner.top}
                width={Math.max(x(range.toM) - x(range.fromM), 0)}
                height={plotHeight}
              />
            ) : null}

            {/* The whole line, held back while a stretch of it is selected… */}
            <g opacity={range ? OUTSIDE_OPACITY : 1}>
              {runs.map((run) => (
                <path
                  key={run.line}
                  d={run.area.replaceAll('BASE', base)}
                  fill={plot.ramp ? `url(#${rampId})` : CHART.ink}
                  fillOpacity={range ? AREA_OPACITY / 2 : AREA_OPACITY}
                />
              ))}
              {runs.map((run) => (
                <path
                  key={run.line}
                  d={run.line}
                  fill="none"
                  stroke={plot.ramp ? `url(#${rampId})` : CHART.ink}
                  strokeWidth={1.4}
                />
              ))}
            </g>

            {/* …and the stretch itself, at full strength, clipped to the two bars. */}
            {range ? (
              <g clipPath={`url(#${clipId})`}>
                {runs.map((run) => (
                  <path
                    key={run.line}
                    d={run.area.replaceAll('BASE', base)}
                    fill={plot.ramp ? `url(#${rampId})` : CHART.ink}
                    fillOpacity={AREA_OPACITY}
                  />
                ))}
                {runs.map((run) => (
                  <path
                    key={run.line}
                    d={run.line}
                    fill="none"
                    stroke={plot.ramp ? `url(#${rampId})` : CHART.ink}
                    strokeWidth={1.8}
                  />
                ))}
              </g>
            ) : null}

            {axes
              ? plot.x.values.map((value) => (
                  <text
                    key={value}
                    className={styles.axisLabel}
                    x={x(value)}
                    y={inner.top + plotHeight + 13}
                    textAnchor={value === 0 ? 'start' : 'middle'}
                  >
                    {km(value, value >= 1000 ? 0 : 1)}
                  </text>
                ))
              : null}
            {axes ? (
              <text
                className={styles.axisLabel}
                x={inner.left + plotWidth}
                y={inner.top + plotHeight + 13}
                textAnchor="end"
              >
                {km(profile.totalM)} km
              </text>
            ) : null}

            {range ? (
              <>
                <Bar at={x(range.fromM)} top={inner.top} height={plotHeight} kind="edge" />
                <Bar at={x(range.toM)} top={inner.top} height={plotHeight} kind="edge" />
              </>
            ) : null}

            {youM !== null ? (
              <Bar
                at={x(youM)}
                top={inner.top}
                height={plotHeight}
                kind="you"
                dot={altitudeAt(profile.distances, profile.altitudeM, youM)}
                y={y}
              />
            ) : null}

            {barM !== null ? (
              <Bar
                at={x(barM)}
                top={inner.top}
                height={plotHeight}
                kind="bar"
                dot={altitudeAt(profile.distances, profile.altitudeM, barM)}
                y={y}
              />
            ) : null}
          </svg>
        ) : null}
      </div>

      {selected && range ? (
        <div className={styles.readout} style={{ paddingLeft: inner.left }}>
          <span className={styles.span}>
            km {km(range.fromM)} → {km(range.toM)}
          </span>
          <Figures stats={selected} />
        </div>
      ) : (
        <>
          {readAt !== null ? (
            <div className={styles.readout} style={{ paddingLeft: inner.left }}>
              <span className={styles.span}>km {km(readAt)}</span>
              {altitude === null ? null : <span>{metres(altitude)} m</span>}
              {gradient === null ? null : (
                <span style={{ color: gradeColour(gradient) }}>{slope(gradient)}%</span>
              )}
            </div>
          ) : null}
          {split && axes ? (
            // No words under them: which side is behind and which is ahead is what the bar
            // between them says, in the place the eye already is.
            <div className={styles.flank} style={{ paddingLeft: inner.left }}>
              <span className={styles.figure}>
                {km(split.done.distanceM)} km · ↑ {metres(split.done.ascentM)} m
              </span>
              <span className={styles.figure}>
                {km(split.toCome.distanceM)} km · ↑ {metres(split.toCome.ascentM)} m
              </span>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}

/** The three figures a selected stretch reports. No average gradient: a mean over a col is a number about nothing. */
function Figures({ stats }: { stats: Stats }) {
  return (
    <>
      <span>{km(stats.distanceM)} km</span>
      <span>↑ {metres(stats.ascentM)} m</span>
      <span>↓ {metres(stats.descentM)} m</span>
    </>
  )
}

/** A rule down the plot, with the height it crosses marked on the line. */
function Bar({
  at,
  top,
  height,
  kind,
  dot,
  y,
}: {
  at: number
  top: number
  height: number
  kind: 'bar' | 'edge' | 'you'
  dot?: number | null
  y?: (altitude: number) => number
}) {
  return (
    <>
      <line className={styles[kind]} x1={at} x2={at} y1={top} y2={top + height} />
      {dot !== null && dot !== undefined && y ? (
        <>
          <circle className={styles.dotRim} cx={at} cy={y(dot)} r={5} />
          <circle className={styles[`${kind}Dot`]} cx={at} cy={y(dot)} r={3.5} />
        </>
      ) : null}
    </>
  )
}
