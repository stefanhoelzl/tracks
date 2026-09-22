import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  type ActivitiesResponse,
  type ActivityDetailResponse,
  type ActivityTagsResponse,
  activitiesResponseSchema,
  activityDetailSchema,
  activityTagsResponseSchema,
  apiErrorSchema,
  type FacetsResponse,
  type Filter,
  facetsResponseSchema,
  formatFilter,
  type TagTypesResponse,
  type TagWrite,
  type TagWriteResponse,
  type TrackCollection,
  type TracksResponse,
  tagTypesResponseSchema,
  tagWriteResponseSchema,
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

/** One line for a banner, whatever was thrown. */
export function message(error: unknown): string | null {
  if (!error) return null
  if (error instanceof ApiFailure) return error.message
  return error instanceof Error ? error.message : String(error)
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

async function send<T>(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null))
    throw new ApiFailure(
      parsed.success
        ? [parsed.data.error, ...(parsed.data.issues ?? []).map((i) => i.message)].join(' — ')
        : response.statusText,
      response.status,
    )
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

/**
 * The previous filter's answer, shown while the next one is asked for — and only while
 * something is being asked for.
 *
 * Signing out removes these queries from the cache, but a mounted observer still holds
 * what it last showed, and an unconditional placeholder hands that straight to the empty
 * query that replaces it: the account's totals and tracks would stay drawn around the
 * planner of somebody who is no longer anybody.
 */
function carryOver(enabled: boolean) {
  return enabled ? keepPreviousData : undefined
}

export function useActivities(filter: Filter, enabled = true) {
  return useQuery({
    queryKey: key('activities', filter),
    enabled,
    queryFn: ({ signal }) =>
      get<ActivitiesResponse>(
        `/api/activities?${formatFilter(filter)}`,
        activitiesResponseSchema,
        signal,
      ),
    // The list must not flash empty while a slider is being dragged.
    placeholderData: carryOver(enabled),
  })
}

export function useTracks(filter: Filter, enabled = true) {
  return useQuery<TrackCollection>({
    queryKey: key('tracks', filter),
    enabled,
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
    placeholderData: carryOver(enabled),
  })
}

export function useFacets(filter: Filter, enabled = true) {
  return useQuery({
    queryKey: key('facets', filter),
    enabled,
    queryFn: ({ signal }) =>
      get<FacetsResponse>(`/api/facets?${formatFilter(filter)}`, facetsResponseSchema, signal),
    placeholderData: carryOver(enabled),
  })
}

export function useActivityDetail(id: number | null, enabled = true) {
  return useQuery({
    queryKey: ['activity', id],
    enabled: enabled && id !== null,
    queryFn: ({ signal }) => fetchActivityDetail(id as number, signal),
  })
}

/** The list, outside the cache: the export reads it once and must not hold it. */
export function fetchActivities(filter: Filter, signal?: AbortSignal) {
  return get<ActivitiesResponse>(
    `/api/activities?${formatFilter(filter)}`,
    activitiesResponseSchema,
    signal,
  )
}

export async function fetchActivityDetail(id: number, signal?: AbortSignal) {
  return decodeActivityDetail(
    await get<ActivityDetailResponse>(`/api/activities/${id}`, activityDetailSchema, signal),
  )
}

/**
 * The registry and the vocabulary, which change only when a tag is written — and then
 * every write invalidates them, so nothing has to guess when they went stale.
 */
export function useTagTypes(enabled = true) {
  return useQuery({
    queryKey: ['tag-types'],
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: ({ signal }) =>
      get<TagTypesResponse>('/api/tag-types', tagTypesResponseSchema, signal),
  })
}

/**
 * A write invalidates everything.
 *
 * All four reads are downstream of the tags: the rows carry them, the map colours by
 * them, the facets count them, and the registry is derived from them. Working out
 * which of the four a particular edit could not have touched would be four rules to
 * get wrong for one refetch of a few hundred rows.
 */
function useInvalidateAll() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries()
}

/** The bulk write. Its target is the filter, so the filter is in the URL, as on a read. */
export function useTagWrite(filter: Filter) {
  const invalidate = useInvalidateAll()

  return useMutation({
    mutationFn: (write: TagWrite) =>
      send<TagWriteResponse>(
        'POST',
        `/api/tags?${formatFilter(filter)}`,
        write,
        tagWriteResponseSchema,
      ),
    onSuccess: invalidate,
  })
}

/** One activity's tags, sent as the array they should now be. */
export function useActivityTags(id: number | null) {
  const invalidate = useInvalidateAll()

  return useMutation({
    mutationFn: (body: { tags: string[]; newType?: TagWrite['newType'] }) =>
      send<ActivityTagsResponse>(
        'PUT',
        `/api/activities/${id}/tags`,
        body,
        activityTagsResponseSchema,
      ),
    onSuccess: invalidate,
  })
}
