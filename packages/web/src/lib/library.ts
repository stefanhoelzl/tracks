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
 * too, and keeps what it had fetched on screen behind the dialog.
 *
 * The switch reads the session out of the cache during render, not from the `access`
 * `App` was handed. That prop is one render behind at the moment that matters: signing out
 * forgets the session and removes these queries, and a render already queued by the
 * sign-out's own pending state still carries the old session — so it would rebuild every
 * query it just lost, enabled, and fetch them all as nobody, with the last answer carried
 * over as a placeholder while the 401s come back. The cache is already nobody by then.
 */
export function useLibrary(filter: Filter, activity: number | null) {
  const session = useQueryClient().getQueryData<Access>(SESSION_KEY)
  const enabled = session != null && !session.lapsed

  return {
    tagTypes: useTagTypes(enabled),
    activities: useActivities(filter, enabled),
    tracks: useTracks(filter, enabled),
    facets: useFacets(filter, enabled),
    detail: useActivityDetail(activity, enabled),
    tagWrite: useTagWrite(filter),
    activityTags: useActivityTags(activity),
  }
}
