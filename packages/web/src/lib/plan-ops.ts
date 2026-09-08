import type { LatLon, Leg, Waypoint, WaypointKind } from '@tracks/routing'
import { nearestIndex } from './geo.ts'
import type { Plan } from './plan.ts'

/**
 * Editing a plan.
 *
 * Pure functions over `Plan`, the way `filter-ops.ts` is pure over `Filter` — the plan
 * lives in the URL, so every edit is *produce the next one*, and there is no state here
 * to get out of step with the address bar.
 */

/** Where a new waypoint goes. ROUTING only ever takes `nearest`; POI is offered all three. */
export type Placement = 'nearest' | 'start' | 'end'

/** The indices, in waypoint order, of the POIs that bound the legs. */
export function poiIndices(waypoints: readonly Waypoint[]): number[] {
  const out: number[] = []
  waypoints.forEach((waypoint, index) => {
    if (waypoint.kind === 'poi') out.push(index)
  })
  return out
}

/**
 * How many legs a plan has — one fewer than its POIs, and zero until there are two.
 *
 * Shaping points do not bound legs, which is the whole consequence of ROUTING being a
 * pass-through rather than a break.
 */
export function legCount(plan: Plan): number {
  return Math.max(0, poiIndices(plan.waypoints).length - 1)
}

/**
 * Where inside leg `legIndex` a point belongs, as an index into `plan.waypoints`.
 *
 * The shaping points already in that leg are ordered by how far along the drawn line
 * they sit, so the new one is placed by the same measure rather than simply appended
 * before the closing POI — otherwise dropping a hint near the start of a leg would put
 * it after every hint near the end, and the route would double back through them.
 *
 * With no routed geometry to measure against there is nothing to compare, so it goes
 * last in the leg. That is only reachable before the first response arrives.
 */
export function insertionAt(
  plan: Plan,
  legs: ReadonlyArray<Leg | undefined>,
  legIndex: number,
  at: LatLon,
): number {
  const pois = poiIndices(plan.waypoints)
  const opens = pois[legIndex]
  const closes = pois[legIndex + 1]
  if (opens === undefined || closes === undefined) return plan.waypoints.length

  const leg = legs[legIndex]
  if (!leg || leg.coordinates.length < 2) return closes

  const along = (point: LatLon) => nearestIndex(leg.coordinates, point.lon, point.lat)
  const target = along(at)

  for (let index = opens + 1; index < closes; index++) {
    const waypoint = plan.waypoints[index]
    if (waypoint && along(waypoint) > target) return index
  }
  return closes
}

/** Resolves the dialog's placement choice to one index. */
export function placementAt(
  plan: Plan,
  legs: ReadonlyArray<Leg | undefined>,
  placement: Placement,
  legIndex: number | null,
  at: LatLon,
): number {
  if (placement === 'start') return 0
  if (placement === 'end') return plan.waypoints.length
  return legIndex === null ? plan.waypoints.length : insertionAt(plan, legs, legIndex, at)
}

export function addWaypoint(plan: Plan, waypoint: Waypoint, index: number): Plan {
  const waypoints = [...plan.waypoints]
  waypoints.splice(Math.max(0, Math.min(index, waypoints.length)), 0, waypoint)
  return { ...plan, waypoints }
}

export function removeWaypoint(plan: Plan, index: number): Plan {
  return { ...plan, waypoints: plan.waypoints.filter((_, at) => at !== index) }
}

export function updateWaypoint(plan: Plan, index: number, patch: Partial<Waypoint>): Plan {
  return {
    ...plan,
    waypoints: plan.waypoints.map((waypoint, at) =>
      at === index ? { ...waypoint, ...patch } : waypoint,
    ),
  }
}

/**
 * Moving a waypoint, and the two-POI rule that shadows every edit.
 *
 * The first two waypoints are the start and the end, so below two POIs there is no leg
 * for a shaping hint to attach to and the kind toggle is not offered at all. Changing a
 * kind can therefore never leave a plan with fewer than two POIs while it has three or
 * more waypoints — this keeps that true rather than trusting every caller to.
 */
export function setKind(plan: Plan, index: number, kind: WaypointKind): Plan {
  const next = updateWaypoint(plan, index, {
    kind,
    // Demoting a stop drops its name, because a shaping point has nothing to be called
    // — and because a bare point is exactly what the wire format wants for one.
    ...(kind === 'routing' ? { name: null } : {}),
  })
  return poiIndices(next.waypoints).length < 2 ? plan : next
}

export function moveWaypoint(plan: Plan, index: number, at: LatLon): Plan {
  return updateWaypoint(plan, index, { lat: at.lat, lon: at.lon })
}

/**
 * Whether the kind is a choice yet.
 *
 * The first two clicks are the start and the end with no toggle at all — until they
 * exist there is no line, and "always inserts into the nearest leg" has no answer.
 */
export function kindIsAChoice(plan: Plan): boolean {
  return plan.waypoints.length >= 2
}
