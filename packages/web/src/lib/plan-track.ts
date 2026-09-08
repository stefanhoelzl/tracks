import type { ActivityTrack } from '@tracks/core'
import type { Leg, Waypoint } from '@tracks/routing'
import { stretches } from '@tracks/routing'

/**
 * A plan's legs, read as one track.
 *
 * The point of this module is that the overview panel needs no new machinery: an
 * `ActivityTrack` is what `profileOf` already takes, so a plan's elevation profile is
 * the activity detail's profile, unchanged, cursor sync included.
 */

/**
 * What each leg looks like on the map, routed or not.
 *
 * One definition, three readers: the layer that draws the plan, the choice of which leg
 * a click meant, and the ordering of shaping points inside a leg. They have to agree —
 * if the line you can see is not the line the click is measured against, *nearest* means
 * something you cannot predict by looking.
 *
 * A leg with no answer yet is the straight run through its own waypoints, which is both
 * what the map draws and where the route will go.
 */
export function legGeometries(
  waypoints: readonly Waypoint[],
  legs: ReadonlyArray<Leg | undefined>,
): Array<Array<[number, number]>> {
  return stretches(waypoints).map((stretch, index) => {
    const leg = legs[index]
    if (leg) return [...leg.coordinates]
    return stretch.map((waypoint): [number, number] => [waypoint.lon, waypoint.lat])
  })
}

export interface PlanTotals {
  distanceM: number
  ascentM: number
  descentM: number
  durationS: number
  /**
   * A leg could not be routed, so these numbers are missing part of the plan.
   *
   * Said out loud rather than folded in silently. The alternative was to beeline the
   * gap, which would put a straight line across a glacier into your distance with
   * nothing pointing at it.
   */
  incomplete: boolean
}

export function planTotals(legs: ReadonlyArray<Leg | undefined>): PlanTotals {
  const totals: PlanTotals = {
    distanceM: 0,
    ascentM: 0,
    descentM: 0,
    durationS: 0,
    incomplete: false,
  }

  for (const leg of legs) {
    if (!leg?.ok) {
      // A leg still in flight is as incomplete as one that failed; both mean the
      // numbers below this are not yet the whole plan.
      totals.incomplete = true
      continue
    }
    totals.distanceM += leg.distanceM
    totals.ascentM += leg.ascentM
    totals.descentM += leg.descentM
    totals.durationS += leg.durationS
  }

  return totals
}

/**
 * Every leg's geometry, end to end.
 *
 * Legs meet at a POI, so each one after the first drops its opening coordinate — the
 * previous leg already ended there, and a repeated point would put a zero-length step
 * in the middle of the profile.
 *
 * An unroutable leg contributes its beeline with **null** altitudes, which is how the
 * profile already draws missing data: a gap rather than a flat line. The shape of the
 * plan survives; the claim about what is under it does not.
 */
export function planTrack(legs: ReadonlyArray<Leg | undefined>): ActivityTrack {
  const coordinates: Array<[number, number]> = []
  const altitudeM: Array<number | null> = []

  for (const leg of legs) {
    if (!leg) continue
    const skip = coordinates.length > 0 ? 1 : 0
    leg.coordinates.slice(skip).forEach((point, index) => {
      coordinates.push(point)
      altitudeM.push(leg.ok ? (leg.altitudeM[index + skip] ?? null) : null)
    })
  }

  // A planned route has no clock: the legs are geometry from the router, not a recording.
  // Absent per point rather than an absent array, so the shape matches a recorded track
  // and nothing downstream has to ask which kind it is holding.
  return { coordinates, altitudeM, secondsFromStart: coordinates.map(() => null) }
}

/**
 * Distance and ascent to the end of each leg — what a POI row reads.
 *
 * `incomplete` is sticky: once a leg has been missed, every total after it is short by
 * that leg, so a row saying "12.4 km" three legs later would be quietly wrong.
 */
export function cumulative(legs: ReadonlyArray<Leg | undefined>): PlanTotals[] {
  const running: PlanTotals[] = []
  let total: PlanTotals = {
    distanceM: 0,
    ascentM: 0,
    descentM: 0,
    durationS: 0,
    incomplete: false,
  }

  for (const leg of legs) {
    total = leg?.ok
      ? {
          distanceM: total.distanceM + leg.distanceM,
          ascentM: total.ascentM + leg.ascentM,
          descentM: total.descentM + leg.descentM,
          durationS: total.durationS + leg.durationS,
          incomplete: total.incomplete,
        }
      : { ...total, incomplete: true }
    running.push(total)
  }

  return running
}

export interface StopReading {
  /** Signed: negative for a stop that comes before the one being measured from. */
  distanceM: number
  ascentM: number
  /** A leg between this stop and the base did not route, so the gap is unknown. */
  incomplete: boolean
}

/**
 * What each stop reads, measured from `base` rather than always from the start.
 *
 * "How far is the hut from here" is the question a list of stops is usually being asked,
 * and *here* is rarely the beginning — it is whichever row you are looking at. So the
 * numbers re-base to the row under the pointer, and fall back to the first stop, which
 * is what they always were.
 *
 * The base row itself returns null: the row you are measuring from carries no numbers,
 * exactly as the first row always did.
 *
 * Values are differences of cumulative figures, so a stop before the base reads negative
 * on both — that far back, and that much less climbing so far.
 */
export function readingsFrom(
  legs: ReadonlyArray<Leg | undefined>,
  base: number,
): Array<StopReading | null> {
  const running = cumulative(legs)

  const at = (stop: number): PlanTotals => {
    if (stop <= 0) return { distanceM: 0, ascentM: 0, descentM: 0, durationS: 0, incomplete: false }
    return (
      running[stop - 1] ?? {
        distanceM: 0,
        ascentM: 0,
        descentM: 0,
        durationS: 0,
        incomplete: true,
      }
    )
  }

  const anchor = at(base)

  return Array.from({ length: running.length + 1 }, (_, stop) => {
    if (stop === base) return null
    const here = at(stop)
    return {
      distanceM: here.distanceM - anchor.distanceM,
      ascentM: here.ascentM - anchor.ascentM,
      // `incomplete` is sticky forward, so whichever of the two stops is later already
      // carries any gap that lies between them.
      incomplete: at(Math.max(stop, base)).incomplete,
    }
  })
}

/**
 * Everything the plan covers, as `[west, south, east, north]`.
 *
 * The waypoints *and* the drawn geometry, because neither is a superset of the other: a
 * route can bulge well outside the box its stops make — around a lake, over the only
 * col — and a stop can sit outside every leg, since a hint before the first stop or
 * after the last belongs to no leg at all.
 *
 * Null when there is nothing to frame, which is what disables the control.
 */
export function planBounds(
  waypoints: readonly Waypoint[],
  legs: ReadonlyArray<Leg | undefined>,
): [number, number, number, number] | null {
  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  const extend = (lon: number, lat: number) => {
    west = Math.min(west, lon)
    east = Math.max(east, lon)
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }

  for (const waypoint of waypoints) extend(waypoint.lon, waypoint.lat)
  for (const leg of legGeometries(waypoints, legs)) {
    for (const [lon, lat] of leg) extend(lon, lat)
  }

  return Number.isFinite(west) ? [west, south, east, north] : null
}
