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

  return { coordinates, altitudeM }
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
