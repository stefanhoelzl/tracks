import { useQueryClient } from '@tanstack/react-query'
import type { Filter } from '@tracks/core'
import {
  useActivities,
  useActivityDetail,
  useActivityTags,
  useFacets,
  useTagTypes,
  useTagWrite,
  useTracks,
} from './api.ts'
import { type Access, SESSION_KEY } from './session.ts'

/**
 * Everything the app reads and writes as somebody.
 *
 * The activities, their tracks and counts, the tag registry, the one that is open, and the
 * two writes — each of them one account's rows, and the half of the app that needs one.
 * Gathered here so that half has a single edge, and one switch: with nobody to ask for,
 * nothing is asked, rather than asked and answered 401. A lapsed session is switched off
 * too, and keeps what it had fetched on screen behind the dialog. A share link is the
 * third case: nobody, and still everything the link shows.
 *
 * The switch reads the session out of the cache during render, not from the `access`
 * `App` was handed. That prop is one render behind at the moment that matters: signing out
 * forgets the session and removes these queries, and a render already queued by the
 * sign-out's own pending state still carries the old session — so it would rebuild every
 * query it just lost, enabled, and fetch them all as nobody, with the last answer carried
 * over as a placeholder while the 401s come back. The cache is already nobody by then.
 */
export function useLibrary(filter: Filter, activity: number | null, shared = false) {
  // Through a share link the token is the credential: there is no session to ask, and
  // the reads go to the link's routes (`ApiRoot`) — all of them but the registry, since
  // a link carries no tags.
  const enabled = useSomebody() || shared

  return {
    tagTypes: useTagTypes(enabled && !shared),
    activities: useActivities(filter, enabled),
    tracks: useTracks(filter, enabled),
    facets: useFacets(filter, enabled),
    detail: useActivityDetail(activity, enabled),
    tagWrite: useTagWrite(filter),
    activityTags: useActivityTags(activity),
  }
}

/**
 * Whether there is somebody to ask as, read from the cache rather than from props — for
 * the reason `useLibrary` gives. Anything else that reads an account's rows outside the
 * library asks this too, so signing out stops it in the same render.
 */
export function useSomebody(): boolean {
  const session = useQueryClient().getQueryData<Access>(SESSION_KEY)
  return session != null && !session.lapsed
}
