/**
 * The routing interface.
 *
 * One method, an array in and legs out. Whether that is one HTTP request or a loop is
 * the implementation's business and never the caller's — an engine with multi-via
 * support sends one, an engine without sends several, and nothing above this line can
 * tell. That is what makes "single or batched?" not a question the interface has to
 * answer.
 *
 * The same shape `ActivitySource` has had since M1, in its own package because neither
 * half of the app is its natural owner: only the browser calls a router today, but a
 * server-proxied implementation is explicitly anticipated, and an interface that would
 * have to move house to admit one is in the wrong place.
 */

/**
 * The profile vocabulary is the app's, not any engine's.
 *
 * These five words go in the plan fragment, so a shared link keeps meaning the same
 * thing when the engine behind it changes. Each implementation maps them to whatever
 * its own engine calls them — BRouter to profile filenames, Valhalla to a costing
 * model plus a `bicycle_type`. That the mapping is 1:1 on two engines built on
 * different premises is the evidence the vocabulary is the right size.
 */
export const PROFILES = ['road', 'trekking', 'gravel', 'mtb', 'hiking'] as const

export type Profile = (typeof PROFILES)[number]

export const PROFILE_LABELS: Record<Profile, string> = {
  road: 'Road',
  trekking: 'Trekking',
  gravel: 'Gravel',
  mtb: 'MTB',
  hiking: 'Hiking',
}

export function isProfile(value: string): value is Profile {
  return (PROFILES as readonly string[]).includes(value)
}

export interface LatLon {
  lat: number
  lon: number
}

/**
 * A halt, or a hint.
 *
 * `poi` is a **break**: the router may turn around there, and it bounds a leg. `routing`
 * is a **pass-through**: no u-turn, no leg boundary. The difference is not presentational,
 * which is the decision the whole planning design falls out of.
 */
export type WaypointKind = 'poi' | 'routing'

export interface Waypoint extends LatLon {
  kind: WaypointKind
  /** POIs carry one; a shaping hint has nothing to be called. */
  name: string | null
}

/** One POI-to-POI stretch, with whatever shaping points fell inside it. */
export interface RoutedLeg {
  ok: true
  from: Waypoint
  to: Waypoint
  /** GeoJSON order, `[lon, lat]` — ready for a source without a second pass. */
  coordinates: Array<[number, number]>
  /**
   * Height above sea level per point, aligned by index with `coordinates`.
   *
   * Part of what a leg *is*, rather than a second interface to compose: an engine that
   * supplies elevation passes it through, one that does not fills it before returning.
   * So the profile view has no nulls to handle and `ElevationProfile` is reused exactly
   * as the activity detail uses it.
   */
  altitudeM: number[]
  distanceM: number
  ascentM: number
  descentM: number
  durationS: number
}

/** A stretch the engine could not connect. Drawn dashed; named, never hidden. */
export interface FailedLeg {
  ok: false
  from: Waypoint
  to: Waypoint
  /** A beeline, so the shape of the plan survives one leg that cannot be routed. */
  coordinates: [[number, number], [number, number]]
  reason: string
}

export type Leg = RoutedLeg | FailedLeg

/**
 * The engine is unreachable, refusing, or answering with something unrecognisable.
 *
 * Distinct from a `FailedLeg` on purpose: that says *these two points cannot be
 * connected*, which is a fact about the plan and belongs on the row. This says *ask
 * again later*, which is a fact about the server and belongs nowhere near a waypoint.
 */
export class RouterError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RouterError'
    this.status = status
  }
}

export interface Router {
  readonly id: string
  /** Which of the five this engine serves. The UI greys the rest. */
  readonly profiles: readonly Profile[]
  route(waypoints: readonly Waypoint[], profile: Profile, signal?: AbortSignal): Promise<Leg[]>
}

/**
 * Split a waypoint sequence into the POI-to-POI stretches that become legs.
 *
 * Every implementation needs this and none of them should get it subtly different, so
 * it lives with the interface rather than in each adapter. Leading and trailing shaping
 * points have no leg to belong to and are dropped: a hint about how to get somewhere is
 * meaningless before the first place and after the last.
 */
export function stretches(waypoints: readonly Waypoint[]): Waypoint[][] {
  const out: Waypoint[][] = []
  let current: Waypoint[] | null = null

  for (const waypoint of waypoints) {
    if (waypoint.kind === 'poi') {
      if (current) {
        current.push(waypoint)
        out.push(current)
      }
      current = [waypoint]
    } else if (current) {
      current.push(waypoint)
    }
  }

  return out
}

/**
 * Descent, from ascent and the two ends.
 *
 * Over any path, `descent = ascent - (end - start)` exactly — climb and drop can only
 * differ by where you finished relative to where you started. So the second number is
 * derived from the first rather than summed separately, which matters because the
 * ascent an engine reports is usually *filtered* (small wobbles discarded as noise) and
 * a raw sum for the descent would disagree with it by tens of metres on the same track.
 * One figure, one filter, and two readouts that cannot contradict each other.
 */
export function descentOf(ascentM: number, altitudeM: readonly number[]): number {
  const start = altitudeM[0]
  const end = altitudeM[altitudeM.length - 1]
  if (start === undefined || end === undefined) return 0
  return Math.max(0, ascentM - (end - start))
}
