import { useQueries } from '@tanstack/react-query'
import {
  BRouterRouter,
  type Leg,
  PhotonGeocoder,
  type Profile,
  type Router,
  stretches,
  type Waypoint,
} from '@tracks/routing'
import { useMemo } from 'react'
import type { Plan } from './plan.ts'

/**
 * The engine the app is wired to, and the legs it produces.
 *
 * One place naming the implementation, so swapping it is a line here rather than a
 * search — the same thing `basemap.ts` does for tiles. Everything above this point
 * knows only the interface.
 */
export const router: Router = new BRouterRouter()
export const geocoder = new PhotonGeocoder()

/**
 * A leg's identity: its two ends, whatever it passes through, and the profile.
 *
 * This is the cache key, and the reason there is no cache to write. TanStack Query
 * already keys, dedupes, aborts and retains — so a leg that has been routed once is
 * repainted from memory, and stepping Back through your own edits costs no request at
 * all. Rounded to six decimals because that is the precision the fragment stores, so a
 * plan reloaded from a link keys identically to the one that made it.
 */
function legKey(stretch: readonly Waypoint[], profile: Profile): unknown[] {
  return [
    'leg',
    profile,
    stretch.map((w) => `${w.lat.toFixed(6)},${w.lon.toFixed(6)},${w.kind}`).join('|'),
  ]
}

export interface PlanLegs {
  /** One slot per leg, in order. `undefined` while that leg is still in flight. */
  legs: Array<Leg | undefined>
  pending: boolean
  /** The engine refusing or unreachable — not a leg that cannot be routed. */
  error: string | null
}

/**
 * Every leg of a plan, one query each.
 *
 * Per leg rather than per plan, because that is what makes an edit cheap: appending a
 * waypoint asks for one leg and repaints the rest from cache, and dragging a middle one
 * asks for two. A single query over the whole plan would refetch ten legs to move one
 * point.
 *
 * `staleTime: Infinity` — a leg between two fixed coordinates on one profile does not
 * change while you are looking at it, and the roads underneath it change on a timescale
 * no cache should care about.
 */
export function usePlanLegs(plan: Plan, enabled: boolean): PlanLegs {
  const runs = useMemo(() => (enabled ? stretches(plan.waypoints) : []), [enabled, plan.waypoints])

  const results = useQueries({
    queries: runs.map((stretch) => ({
      queryKey: legKey(stretch, plan.profile),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        router.route(stretch, plan.profile, signal).then((legs) => legs[0] ?? null),
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: 60 * 60 * 1000,
      // One retry, like every other query here. A router that is refusing wants to be
      // asked less, not more.
      retry: 1,
    })),
  })

  return {
    legs: results.map((result) => result.data ?? undefined),
    pending: results.some((result) => result.isPending),
    error: results.find((result) => result.error)?.error?.message ?? null,
  }
}
