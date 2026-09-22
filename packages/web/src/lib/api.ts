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
  type Share,
  type ShareCreate,
  type SharedView,
  type ShareUpdate,
  sharedViewSchema,
  shareSchema,
  sharesResponseSchema,
  type TagTypesResponse,
  type TagWrite,
  type TagWriteResponse,
  type TrackCollection,
  type TracksResponse,
  tagTypesResponseSchema,
  tagWriteResponseSchema,
  tracksResponseSchema,
} from '@tracks/core'
import { createContext, useContext } from 'react'
import { z } from 'zod'
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

/**
 * Where the reads go: `/api` for an account, `/api/share/<token>` for a link.
 *
 * The public routes are the signed-in ones under a longer prefix, answering the same
 * schemas, so the hooks below need to know nothing about which they are talking to —
 * the page decides once, at the top, and everything under it follows.
 */
export const ApiRoot = createContext('/api')

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
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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

  // A 204 has no body to parse; the schema says whether nothing was what was expected.
  return schema.parse(response.status === 204 ? undefined : await response.json())
}

/**
 * One key per route, all of them derived from the same serialized filter — so the
 * cache and the URL are the same fact, and there is no third representation to keep
 * in step.
 */
function key(root: string, route: string, filter: Filter): [string, string, string] {
  return [route, formatFilter(filter).toString(), root]
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
  const root = useContext(ApiRoot)
  return useQuery({
    queryKey: key(root, 'activities', filter),
    enabled,
    queryFn: ({ signal }) =>
      get<ActivitiesResponse>(
        `${root}/activities?${formatFilter(filter)}`,
        activitiesResponseSchema,
        signal,
      ),
    // The list must not flash empty while a slider is being dragged.
    placeholderData: carryOver(enabled),
  })
}

export function useTracks(filter: Filter, enabled = true) {
  const root = useContext(ApiRoot)
  return useQuery<TrackCollection>({
    queryKey: key(root, 'tracks', filter),
    enabled,
    // Decoded once here, so the cache holds what the map consumes rather than the wire
    // shape, and a repaint never decodes again.
    queryFn: async ({ signal }) =>
      decodeTracks(
        await get<TracksResponse>(
          `${root}/tracks?${formatFilter(filter)}`,
          tracksResponseSchema,
          signal,
        ),
      ),
    placeholderData: carryOver(enabled),
  })
}

export function useFacets(filter: Filter, enabled = true) {
  const root = useContext(ApiRoot)
  return useQuery({
    queryKey: key(root, 'facets', filter),
    enabled,
    queryFn: ({ signal }) =>
      get<FacetsResponse>(`${root}/facets?${formatFilter(filter)}`, facetsResponseSchema, signal),
    placeholderData: carryOver(enabled),
  })
}

export function useActivityDetail(id: number | null, enabled = true) {
  const root = useContext(ApiRoot)
  return useQuery({
    queryKey: ['activity', id, root],
    enabled: enabled && id !== null,
    queryFn: ({ signal }) => fetchActivityDetail(id as number, signal, root),
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

/** `root` is the page's `ApiRoot`: a share link's detail comes from the link's own route. */
export async function fetchActivityDetail(id: number, signal?: AbortSignal, root = '/api') {
  return decodeActivityDetail(
    await get<ActivityDetailResponse>(`${root}/activities/${id}`, activityDetailSchema, signal),
  )
}

/**
 * The registry and the vocabulary, which change only when a tag is written — and then
 * every write invalidates them, so nothing has to guess when they went stale.
 *
 * Not asked for at all through a share link, which has no tags to describe.
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

const SHARES_KEY = ['shares']

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
  // Your links are the one read a tag cannot touch: they store a filter, not the rows.
  return () =>
    queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== SHARES_KEY[0] })
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

/**
 * What a link says about itself before anything is drawn: that it works, and its name.
 *
 * Its 404 is an answer — the link is gone — so it is not retried, for the same reason the
 * session's 401 is not.
 */
export function useSharedView(token: string) {
  return useQuery<SharedView | null>({
    queryKey: ['shared-view', token],
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      try {
        return await get<SharedView>(`/api/share/${token}`, sharedViewSchema, signal)
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 404) return null
        throw error
      }
    },
  })
}

/** Your links. Only the Share button reads them — for its dot, and its list. */
export function useShares(enabled: boolean) {
  return useQuery({
    queryKey: SHARES_KEY,
    enabled,
    queryFn: ({ signal }) => get('/api/shares', sharesResponseSchema, signal),
  })
}

function useInvalidateShares() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: SHARES_KEY })
}

/** The link for a filter — made, or the one it already had. The filter rides in the URL. */
export function useShareCreate() {
  const invalidate = useInvalidateShares()
  return useMutation({
    mutationFn: ({ filter, ...body }: ShareCreate & { filter: Filter }) =>
      send<Share>('POST', `/api/shares?${formatFilter(filter)}`, body, shareSchema),
    onSuccess: invalidate,
  })
}

export function useShareUpdate() {
  const invalidate = useInvalidateShares()
  return useMutation({
    mutationFn: ({ token, ...body }: ShareUpdate & { token: string }) =>
      send<Share>('PATCH', `/api/shares/${token}`, body, shareSchema),
    onSuccess: invalidate,
  })
}

export function useShareRevoke() {
  const invalidate = useInvalidateShares()
  return useMutation({
    mutationFn: (token: string) => send('DELETE', `/api/shares/${token}`, undefined, z.undefined()),
    onSuccess: invalidate,
  })
}
