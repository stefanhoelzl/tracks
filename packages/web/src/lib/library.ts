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
 * Gathered here so that half has a single edge.
 */
export function useLibrary(filter: Filter, activity: number | null) {
  return {
    tagTypes: useTagTypes(),
    activities: useActivities(filter),
    tracks: useTracks(filter),
    facets: useFacets(filter),
    detail: useActivityDetail(activity),
    tagWrite: useTagWrite(filter),
    activityTags: useActivityTags(activity),
  }
}
