import type { LatLon, Leg, Waypoint, WaypointKind } from '@tracks/routing'
import { nearestOnPath } from './geo.ts'
import type { Plan } from './plan.ts'
import { legGeometries } from './plan-track.ts'

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
 * Which leg a click meant — the nearest one, measured against the line you can see.
 *
 * *Nearest*, not *hit*. Requiring the pointer to land on the line made shaping a route
 * a game of aiming at a few pixels, and it failed outright whenever the router had not
 * answered, because then there was no line under the cursor at all. Every leg is a
 * candidate and the closest wins, so a click anywhere on the map has an answer.
 *
 * Null only when there is no leg yet, which is the case the kind toggle is hidden for.
 */
export function nearestLeg(
  plan: Plan,
  legs: ReadonlyArray<Leg | undefined>,
  at: LatLon,
): number | null {
  let best: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  legGeometries(plan.waypoints, legs).forEach((coordinates, index) => {
    const { distanceM } = nearestOnPath(coordinates, at.lon, at.lat)
    if (distanceM < bestDistance) {
      bestDistance = distanceM
      best = index
    }
  })

  return best
}

/**
 * Where inside leg `legIndex` a point belongs, as an index into `plan.waypoints`.
 *
 * The shaping points already in that leg are ordered by how far along the drawn line
 * they sit, so the new one is placed by the same measure rather than simply appended
 * before the closing POI — otherwise dropping a hint near the start of a leg would put
 * it after every hint near the end, and the route would double back through them.
 *
 * Measured against the same geometry the map drew, routed or not, so *where along* means
 * what it looks like it means even before the router has answered.
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

  const coordinates = legGeometries(plan.waypoints, legs)[legIndex]
  if (!coordinates || coordinates.length < 2) return closes

  const along = (point: LatLon) => nearestOnPath(coordinates, point.lon, point.lat).position
  const target = along(at)

  for (let index = opens + 1; index < closes; index++) {
    const waypoint = plan.waypoints[index]
    if (waypoint && along(waypoint) > target) return index
  }
  return closes
}

/** How a leg reads in the dialog: the two stops it runs between. */
export function legLabel(plan: Plan, legIndex: number): string | null {
  const pois = plan.waypoints.filter((waypoint) => waypoint.kind === 'poi')
  const from = pois[legIndex]
  const to = pois[legIndex + 1]
  if (!from || !to) return null
  return `${from.name ?? 'stop'} → ${to.name ?? 'stop'}`
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

/**
 * A stop and the shaping points that lead out of it, moved as one.
 *
 * `from` and `to` are POI ordinals, because that is what the list shows — the ticks
 * between two rows belong to the leg leaving the row above them, so a stop drags with
 * the way out of it. Moving a POI while its hints stayed behind would leave the route
 * doubling back through them.
 *
 * Shaping points before the first POI have no stop to belong to and stay where they
 * are; they are dropped when the plan is routed anyway.
 */
export function moveStop(plan: Plan, from: number, to: number): Plan {
  const head: Waypoint[] = []
  const blocks: Waypoint[][] = []

  for (const waypoint of plan.waypoints) {
    if (waypoint.kind === 'poi') blocks.push([waypoint])
    else if (blocks.length === 0) head.push(waypoint)
    else blocks[blocks.length - 1]?.push(waypoint)
  }

  const block = blocks[from]
  if (!block || from === to || to < 0 || to >= blocks.length) return plan

  const next = [...blocks]
  next.splice(from, 1)
  next.splice(to, 0, block)
  return { ...plan, waypoints: [...head, ...next.flat()] }
}
