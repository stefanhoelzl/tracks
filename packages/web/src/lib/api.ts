import { useQuery } from '@tanstack/react-query'
import {
  type ActivitiesResponse,
  type ActivityDetailResponse,
  activitiesResponseSchema,
  activityDetailSchema,
  apiErrorSchema,
  type FacetsResponse,
  type Filter,
  facetsResponseSchema,
  formatFilter,
  type TagTypesResponse,
  type TrackCollection,
  type TracksResponse,
  tagTypesResponseSchema,
  tracksResponseSchema,
} from '@tracks/core'
import type { z } from 'zod'
import { decodeActivityDetail, decodeTracks } from './tracks.ts'

/**
 * The client half of the contract.
 *
 * Every response is parsed against the schema the server validated it with, so a
 * shape that drifts fails here — with a field name — rather than as an undefined
 * inside a component. On a few hundred rows the parse is free, and it is the only
 * thing standing between a hand-edited database and a blank screen.
 */

/** Carries the server's message rather than a status code, so a banner can say it. */
export class ApiFailure extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
  }
}

async function get<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })

  if (!response.ok) {
    const body = apiErrorSchema.safeParse(await response.json().catch(() => null))
    const detail = body.success
      ? [body.data.error, ...(body.data.issues ?? []).map((i) => `${i.path}: ${i.message}`)].join(
          ' — ',
        )
      : response.statusText
    throw new ApiFailure(detail, response.status)
  }

  return schema.parse(await response.json())
}

/**
 * One key per route, all of them derived from the same serialized filter — so the
 * cache and the URL are the same fact, and there is no third representation to keep
 * in step.
 */
function key(route: string, filter: Filter): [string, string] {
  return [route, formatFilter(filter).toString()]
}

export function useActivities(filter: Filter) {
  return useQuery({
    queryKey: key('activities', filter),
    queryFn: ({ signal }) =>
      get<ActivitiesResponse>(
        `/api/activities?${formatFilter(filter)}`,
        activitiesResponseSchema,
        signal,
      ),
    // The list must not flash empty while a slider is being dragged.
    placeholderData: (previous) => previous,
  })
}

export function useTracks(filter: Filter) {
  return useQuery<TrackCollection>({
    queryKey: key('tracks', filter),
    // Decoded once here, so the cache holds what the map consumes rather than the wire
    // shape, and a repaint never decodes again.
    queryFn: async ({ signal }) =>
      decodeTracks(
        await get<TracksResponse>(
          `/api/tracks?${formatFilter(filter)}`,
          tracksResponseSchema,
          signal,
        ),
      ),
    placeholderData: (previous) => previous,
  })
}

export function useFacets(filter: Filter) {
  return useQuery({
    queryKey: key('facets', filter),
    queryFn: ({ signal }) =>
      get<FacetsResponse>(`/api/facets?${formatFilter(filter)}`, facetsResponseSchema, signal),
    placeholderData: (previous) => previous,
  })
}

export function useActivityDetail(id: number | null) {
  return useQuery({
    queryKey: ['activity', id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      decodeActivityDetail(
        await get<ActivityDetailResponse>(`/api/activities/${id}`, activityDetailSchema, signal),
      ),
  })
}

/** The registry changes only when you change it, which M3 has no way to do. */
export function useTagTypes() {
  return useQuery({
    queryKey: ['tag-types'],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      get<TagTypesResponse>('/api/tag-types', tagTypesResponseSchema, signal),
  })
}
