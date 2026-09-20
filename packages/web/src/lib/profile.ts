/**
 * The elevation profile's arithmetic, shared by the four places that draw one.
 *
 * Everything here is a pure function of numbers, and everything here is mirrored in Kotlin
 * (`plan/Profile.kt`) and pinned to this file by `profile.json`. The painting and the gestures
 * are each platform's own; the axis a ride is drawn against, the point a finger landed on and
 * the figures under the bar are not, because a profile that answers "how much is left" with a
 * different number on the phone than in the browser is two profiles.
 *
 * Kotlin compiled to Wasm would have made this one source rather than two. It was weighed and
 * declined for a few hundred lines of arithmetic: it puts a JDK in the web's build path and a
 * Kotlin stdlib in the browser's bundle, and the fixture already fails the build when the two
 * drift. The calculus changes the day something large — BRouter in the browser — wants sharing.
 */

/** A labelled axis: where the gridlines are, and what the ends of the scale became. */
export interface Axis {
  /** The bottom of the scale, on a round number. */
  min: number
  /** The top of the scale, on a round number. */
  max: number
  /** The distance between gridlines. */
  step: number
  /** Every gridline, `min` and `max` included. */
  values: number[]
}

/**
 * The steps a height axis is allowed to use.
 *
 * Round numbers a person reads without doing arithmetic: a col is 1,200 m and the line under it
 * is 1,000, never 1,037. The list runs far enough down for a canal path and far enough up for
 * the Alps, and each step is a 1, 2 or 5 of its decade so consecutive gridlines stay easy to
 * count between.
 */
const HEIGHT_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]

/** The same, in metres, for distance along the track: a half-kilometre up to a hundred. */
const DISTANCE_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000]

/**
 * At most this many gaps between gridlines, so an axis carries three to five labels.
 *
 * More than that and a 96 px profile is a ruler with a line drawn on it; fewer and the two
 * labels say only how high the ride went, which is what the profile already showed.
 */
const MOST_GAPS = 4

function stepFor(span: number, steps: number[], mostGaps: number): number {
  return steps.find((step) => span / step <= mostGaps) ?? steps[steps.length - 1]!
}

/**
 * The height axis for a profile between [lowM] and [highM], at least [minSpanM] tall.
 *
 * The minimum span survived the arrival of gridlines, and is snapped out to the step: without
 * it a flat valley loop fills the box and draws exactly like a col, and with it the labels
 * would otherwise read 612 and 812. The bottom is rounded down and the top up, so the drawn
 * line never touches either edge and both ends of the scale are numbers, not measurements.
 */
export function heightAxis(lowM: number, highM: number, minSpanM: number): Axis {
  const span = Math.max(highM - lowM, minSpanM)
  const step = stepFor(span, HEIGHT_STEPS, MOST_GAPS)

  const min = Math.floor(lowM / step) * step
  const reach = Math.max(highM, min + minSpanM)
  const max = Math.max(Math.ceil(reach / step) * step, min + step)

  return { min, max, step, values: ticks(min, max, step) }
}

/**
 * The distance axis for a track [totalM] long.
 *
 * It starts at zero always — the track does — and the last gridline is the last round number
 * that fits, which is why the total is drawn at the end of the axis rather than left to a
 * label that would hang half its width past the panel.
 */
export function distanceAxis(totalM: number): Axis {
  const step = stepFor(totalM, DISTANCE_STEPS, MOST_GAPS + 1)
  const max = Math.floor(totalM / step) * step
  return { min: 0, max, step, values: ticks(0, max, step) }
}

function ticks(min: number, max: number, step: number): number[] {
  const out: number[] = []
  // Counted rather than accumulated, so a step of 0.1 cannot drift the last value off its label.
  for (let at = 0; min + at * step <= max + step / 1000; at++) out.push(min + at * step)
  return out
}

/** How far a stretch of track runs, and what it does with its height. */
export interface Stats {
  distanceM: number
  ascentM: number
  descentM: number
}

const NOTHING: Stats = { distanceM: 0, ascentM: 0, descentM: 0 }

/**
 * The height [alongM] metres in, interpolated between the drawn points either side.
 *
 * Null inside a dropout, and at either end of one: a height half way across a gap in the data
 * is invented, and the profile draws a gap there for the same reason.
 */
export function altitudeAt(
  distances: number[],
  altitudeM: Array<number | null>,
  alongM: number,
): number | null {
  if (distances.length === 0) return null
  if (alongM <= distances[0]!) return altitudeM[0] ?? null
  const after = distances.findIndex((at) => at >= alongM)
  if (after < 0) return altitudeM[altitudeM.length - 1] ?? null

  const before = altitudeM[after - 1]
  const beyond = altitudeM[after]
  if (before === null || before === undefined || beyond === null || beyond === undefined)
    return null

  const span = distances[after]! - distances[after - 1]!
  if (span <= 0) return beyond
  return before + ((alongM - distances[after - 1]!) / span) * (beyond - before)
}

/**
 * What the track does between [fromM] and [toM]: how far, how much up, how much down.
 *
 * Measured over the points the profile drew rather than over the track, because those are the
 * points the picture is made of — a figure that disagreed with the shape above it would be
 * right and useless. Both ends are interpolated, so dragging a bar changes the numbers
 * smoothly instead of in steps of whatever the sampling happened to be.
 *
 * A dropout contributes nothing: the climb across a gap in the data is not known, and counting
 * the jump between the heights either side of it would invent a wall.
 */
export function statsBetween(
  distances: number[],
  altitudeM: Array<number | null>,
  fromM: number,
  toM: number,
): Stats {
  const start = Math.min(fromM, toM)
  const end = Math.max(fromM, toM)
  if (distances.length === 0 || end <= start) return { ...NOTHING }

  let ascentM = 0
  let descentM = 0
  let last: number | null = altitudeAt(distances, altitudeM, start)

  for (let at = 0; at < distances.length; at++) {
    const where = distances[at]!
    if (where <= start) continue
    if (where >= end) break
    const height = altitudeM[at] ?? null
    if (height !== null && last !== null) {
      const change = height - last
      if (change > 0) ascentM += change
      else descentM -= change
    }
    last = height
  }

  const finish = altitudeAt(distances, altitudeM, end)
  if (finish !== null && last !== null) {
    const change = finish - last
    if (change > 0) ascentM += change
    else descentM -= change
  }

  return { distanceM: end - start, ascentM, descentM }
}

/** A profile cut in two at a point: what is behind it, and what is still ahead. */
export interface Split {
  done: Stats
  toCome: Stats
}

/**
 * The track either side of [atM] — the flanking row under every profile.
 *
 * Riding, [atM] is where you are and the two halves are literally done and to come. Planning
 * there is no you, so it is wherever the bar was put, and "done" means "by the time you reach
 * the bar". Same arithmetic, and the words are true in both readings.
 */
export function splitAt(distances: number[], altitudeM: Array<number | null>, atM: number): Split {
  const totalM = distances[distances.length - 1] ?? 0
  const at = Math.min(Math.max(atM, 0), totalM)
  return {
    done: statsBetween(distances, altitudeM, 0, at),
    toCome: statsBetween(distances, altitudeM, at, totalM),
  }
}

/**
 * Where a pointer at [fraction] across the plot landed, in metres along the track.
 *
 * The plot is linear in distance, so this is a multiplication — it exists so that the web and
 * the phone cannot disagree about whether the edges are inclusive, which is the kind of thing
 * that makes a bar unreachable at one end of a track on one platform only.
 */
export function alongAt(totalM: number, fraction: number): number {
  return Math.min(Math.max(fraction, 0), 1) * totalM
}

/**
 * The points of a track between [fromM] and [toM] along it, both ends interpolated.
 *
 * What the map draws when a stretch is selected on the profile: the stretch keeps its colour and the
 * track either side of it is held back, so the two pictures agree about which piece of the ride is
 * being talked about. Interpolated ends rather than the nearest recorded points, because a bar
 * dragged half way between two of them should move the highlight, not snap it.
 */
export function sliceBetween(
  points: Array<[number, number]>,
  along: number[],
  fromM: number,
  toM: number,
): Array<[number, number]> {
  const start = Math.min(fromM, toM)
  const end = Math.max(fromM, toM)
  if (points.length < 2 || end <= start) return []

  const at = (alongM: number): [number, number] => {
    const after = along.findIndex((where) => where >= alongM)
    if (after <= 0) return points[after < 0 ? points.length - 1 : 0]!
    const a = points[after - 1]!
    const b = points[after]!
    const span = along[after]! - along[after - 1]!
    const t = span <= 0 ? 1 : (alongM - along[after - 1]!) / span
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }

  const out: Array<[number, number]> = [at(start)]
  for (let i = 0; i < along.length; i++) {
    if (along[i]! <= start || along[i]! >= end) continue
    out.push(points[i]!)
  }
  out.push(at(end))
  return out
}
