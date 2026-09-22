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

/**
 * Everything the app reads and writes as somebody.
 *
 * The activities, their tracks and counts, the tag registry, the one that is open, and the
 * two writes — each of them one account's rows, and the half of the app that needs one.
 * Gathered here so that half has a single edge, and one switch: with nobody to ask for,
 * nothing is asked, rather than asked and answered 401. A lapsed session is switched off
 * too, and keeps what it had fetched on screen behind the dialog.
 */
export function useLibrary(filter: Filter, activity: number | null, enabled: boolean) {
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
