import polyline from '@mapbox/polyline'
import { isProfile, type Profile, type Waypoint } from '@tracks/routing'

/**
 * The plan, and its grammar.
 *
 * It lives in the URL **fragment**, which is the one part of an address that is never
 * transmitted. Everything else this app knows is either already on the server or is on
 * its way there; where you are thinking of going next is not, and a fragment is how it
 * stays that way — the same rule that keeps a Komoot password and a Strava archive off
 * the server, applied to the only new data M8 creates.
 *
 * Not in `packages/core`, unlike `Filter` and `View`. Core is what both sides run
 * identically and its only dependency is Zod; the plan reaches no side but this one, and
 * putting a polyline codec in core to serialize something the server never sees would
 * cost the boundary that decision protects.
 *
 * The fragment is itself a `URLSearchParams`, so escaping is the platform's problem
 * rather than this module's — which matters more than it sounds. Polyline encoding emits
 * ASCII 63–126, and that range includes a backslash, which a fragment may not carry raw.
 */

export interface Plan {
  /** Empty until someone types one. It exists to caption a shared link. */
  name: string
  profile: Profile
  waypoints: Waypoint[]
}

/** The all-rounder, and the one a plan starts as. Never written to the fragment. */
export const DEFAULT_PROFILE: Profile = 'trekking'

export function emptyPlan(): Plan {
  return { name: '', profile: DEFAULT_PROFILE, waypoints: [] }
}

export function isEmpty(plan: Plan): boolean {
  return plan.waypoints.length === 0 && plan.name === ''
}

/**
 * Coordinates go through the codec the app already ships, at about six characters a
 * waypoint. Coordinates were never what makes a plan URL long — names are.
 */
function encodePoints(waypoints: readonly Waypoint[]): string {
  return polyline.encode(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]))
}

export function formatPlan(plan: Plan): string {
  if (isEmpty(plan)) return ''

  const params = new URLSearchParams()
  if (plan.name !== '') params.set('name', plan.name)
  if (plan.profile !== DEFAULT_PROFILE) params.set('profile', plan.profile)

  if (plan.waypoints.length > 0) {
    params.set('at', encodePoints(plan.waypoints))
    params.set('kinds', plan.waypoints.map((w) => (w.kind === 'poi' ? 'p' : 'r')).join(''))
    // One `poi` per POI, in order, so an unnamed one keeps its slot as an empty value
    // rather than shifting every name after it onto the wrong place.
    for (const waypoint of plan.waypoints) {
      if (waypoint.kind === 'poi') params.append('poi', waypoint.name ?? '')
    }
  }

  return params.toString()
}

/**
 * Throws on a fragment whose parts disagree, rather than dropping waypoints quietly.
 *
 * `useUrlState` already has somewhere to put that: the same banner a hand-edited filter
 * gets. Losing half a plan without being told would be the worse failure by a distance.
 */
export function parsePlan(hash: string): Plan {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)

  const at = params.get('at')
  if (at === null || at === '') {
    const name = params.get('name') ?? ''
    return { ...emptyPlan(), name }
  }

  const points = polyline.decode(at)
  const kinds = params.get('kinds') ?? ''
  if (kinds.length !== points.length) {
    throw new Error(`plan has ${points.length} waypoints but ${kinds.length} kinds`)
  }

  const names = params.getAll('poi')
  let poi = 0
  const waypoints: Waypoint[] = points.map(([lat, lon], index) => {
    if (kinds[index] !== 'p') return { lat, lon, kind: 'routing', name: null }
    const name = names[poi++] ?? ''
    return { lat, lon, kind: 'poi', name: name === '' ? null : name }
  })

  const profile = params.get('profile')

  return {
    name: params.get('name') ?? '',
    profile: profile !== null && isProfile(profile) ? profile : DEFAULT_PROFILE,
    waypoints,
  }
}
