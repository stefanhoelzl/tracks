import { z } from 'zod'
import { RANGE_KEYS } from './filter.ts'
import { newTypeSchema, tagTypeSchema } from './tags.ts'

/**
 * The API contract.
 *
 * Hand-written schemas rather than inferred end-to-end types: these are read far
 * more often than they are written, and an inferred blob documents nothing. Both
 * ends parse against them — the server on the way out, the browser on the way in —
 * so a shape that drifts fails at the boundary with a field name attached.
 */

/** One row of the list. Everything the sidebar filters on, plus what a row draws. */
export const activityRowSchema = z.object({
  id: z.number().int(),
  source: z.string(),
  title: z.string().nullable(),
  /** UTC instant, ISO8601. */
  startedAt: z.string(),
  /** Seconds east of UTC. */
  utcOffset: z.number().int(),
  /**
   * `started_at` shifted into the activity's own zone. Derived in SQL rather than
   * stored — the brief's reason for having no `local_date` column holds here too —
   * but sent, because every list row and every date filter reads it.
   */
  localDate: z.string(),
  distanceM: z.number().nullable(),
  durationS: z.number().int().nullable(),
  elapsedS: z.number().int().nullable(),
  elevationGainM: z.number().nullable(),
  /** Metres per second, `distance_m / duration_s`. Null when either input is. */
  speedMs: z.number().nullable(),
  tags: z.array(z.string()),
})

export type ActivityRow = z.infer<typeof activityRowSchema>

export const activitiesResponseSchema = z.object({
  activities: z.array(activityRowSchema),
})

export type ActivitiesResponse = z.infer<typeof activitiesResponseSchema>

/**
 * The map payload: one row per track, geometry still encoded.
 *
 * The database already stores a simplified encoded polyline, and the browser has to walk
 * the payload anyway to bake in a colour — so decoding server-side only bought a bigger
 * wire format. Decoded, the response is ~50k JSON coordinate arrays: 1.14MB to serialize,
 * parse and validate, against 0.23MB and a decode loop. Whole round trip, 28.3ms to 2.6ms.
 *
 * Tags and year ride along so *colour by* is a MapLibre expression over what the payload
 * already holds — changing it repaints without refetching a byte.
 */
export const trackSummarySchema = z.object({
  id: z.number().int(),
  /** Encoded polyline, `[lat, lon]` pairs — the same string the database stores. */
  polyline: z.string(),
  tags: z.array(z.string()),
  year: z.number().int(),
})

export const tracksResponseSchema = z.object({
  tracks: z.array(trackSummarySchema),
})

export type TrackSummary = z.infer<typeof trackSummarySchema>
export type TracksResponse = z.infer<typeof tracksResponseSchema>

/**
 * The decoded form, ready for `source.setData()`.
 *
 * A type rather than a schema: this is what the browser *builds* from the payload above,
 * not something it receives, and validating our own decoder's output would cost more than
 * the decode did.
 */
export interface TrackFeature {
  type: 'Feature'
  id: number
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> }
  properties: { id: number; tags: string[]; year: number }
}

export interface TrackCollection {
  type: 'FeatureCollection'
  features: TrackFeature[]
}

/** One selectable value of a tag type, with its count under the self-excluded filter. */
export const tagValueCountSchema = z.object({
  value: z.string(),
  count: z.number().int(),
})

export const tagFacetSchema = z.object({
  type: z.string(),
  values: z.array(tagValueCountSchema),
  /** Activities carrying no tag of this type — the *not set* row. */
  notSet: z.number().int(),
})

/**
 * A range facet. `min`/`max` are the axis, taken from the self-excluded filter, so
 * choosing a sport rescales the distance axis while dragging distance cannot rescale
 * distance. Null when nothing in scope has a value at all.
 */
export const rangeFacetSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
  /** Equal-width counts across [min, max]. Empty when there is no axis to bucket. */
  buckets: z.array(z.number().int()),
})

export type RangeFacet = z.infer<typeof rangeFacetSchema>

export const facetsResponseSchema = z.object({
  /** The totals in the top bar, over the filter exactly as it stands. */
  summary: z.object({
    count: z.number().int(),
    distanceM: z.number(),
    elevationGainM: z.number(),
    durationS: z.number().int(),
  }),
  /**
   * The extent of everything matching the filter *without* its bbox term —
   * `[west, south, east, north]`, or null when nothing in scope has a track.
   *
   * Self-excluded like a facet, and for the same reason: it answers "where is the rest
   * of it?", which the viewport-filtered payload cannot, since that is precisely what
   * the viewport removed. It is what *zoom out to everything* flies to.
   */
  extent: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  /** In registry sort order, so the sidebar renders it as it arrives. */
  tags: z.array(tagFacetSchema),
  ranges: z.object(
    Object.fromEntries(RANGE_KEYS.map((key) => [key, rangeFacetSchema])) as Record<
      (typeof RANGE_KEYS)[number],
      typeof rangeFacetSchema
    >,
  ),
})

export type FacetsResponse = z.infer<typeof facetsResponseSchema>

/** Full resolution, as point objects. At this scale a decoder costs more than bytes. */
/**
 * One activity's full-resolution track.
 *
 * Encoded at precision 6, which is lossless here — trackpoints carry six decimal places,
 * so the round trip is exact rather than merely close. As 34k point objects the same
 * track was 2.65MB; encoded with altitude alongside it is 0.30MB.
 *
 * Altitude is a parallel array, aligned by index with the decoded coordinates, and the
 * detail panel's elevation profile is what reads it. Timestamps are not sent — no
 * consumer has ever read them, and they are still in the database for whatever
 * eventually wants them. The profile plots against distance instead, summed from the
 * coordinates it already has.
 */
export const activityTrackSchema = z.object({
  /** Encoded polyline, `[lat, lon]` pairs, precision 6. */
  polyline: z.string(),
  /** Height above sea level per point, not cumulative gain. */
  altitudeM: z.array(z.number().nullable()),
})

export const activityDetailSchema = z.object({
  activity: activityRowSchema,
  track: activityTrackSchema,
})

/** What the route sends. */
export type ActivityDetailResponse = z.infer<typeof activityDetailSchema>

/** What the browser builds from it — coordinates already in GeoJSON order. */
export interface ActivityTrack {
  coordinates: Array<[number, number]>
  altitudeM: Array<number | null>
}

export interface ActivityDetail {
  activity: ActivityRow
  track: ActivityTrack
}

/**
 * A registered type together with the values in use, counted over *every* activity.
 *
 * Unfiltered on purpose. Every other count in the app is scoped to what you are
 * looking at, and this one must not be: it feeds the autocomplete, which is at its
 * least useful when the filter has narrowed to the activities that lack the tag you
 * are about to apply, and it feeds the colour layout, which has to be the same
 * whichever way the map is panned.
 */
export const registeredTypeSchema = tagTypeSchema.extend({
  values: z.array(tagValueCountSchema),
})

export type RegisteredType = z.infer<typeof registeredTypeSchema>

export const tagTypesResponseSchema = z.object({
  tagTypes: z.array(registeredTypeSchema),
})

export type TagTypesResponse = z.infer<typeof tagTypesResponseSchema>

/**
 * A bulk tag write: what to do, over the filter in the query string.
 *
 * The target is the URL, parsed by the same code every read parses it with, so "the
 * current filter" cannot come to mean two things. `newType` rides along because a type
 * is born with its first tag: creating it and applying that tag are one transaction,
 * and there is no window in which an empty type exists to be collected.
 */
export const tagWriteSchema = z.object({
  add: z.array(z.string()).default([]),
  remove: z.array(z.string()).default([]),
  newType: newTypeSchema.optional(),
})

export type TagWrite = z.infer<typeof tagWriteSchema>

/** How many activities the write actually changed — the result line's one number. */
export const tagWriteResponseSchema = z.object({
  changed: z.number().int(),
})

export type TagWriteResponse = z.infer<typeof tagWriteResponseSchema>

/**
 * One activity's tags, replaced wholesale.
 *
 * The detail panel holds every chip already, so it sends what the row should be rather
 * than naming a change — which makes adding and removing the same request, and leaves
 * no `DELETE` carrying a tag in its query string.
 */
export const activityTagsSchema = z.object({
  tags: z.array(z.string()),
  newType: newTypeSchema.optional(),
})

export const activityTagsResponseSchema = z.object({
  /** As stored: sorted, deduplicated. */
  tags: z.array(z.string()),
})

export type ActivityTagsResponse = z.infer<typeof activityTagsResponseSchema>

/**
 * Signing in.
 *
 * The same request whether the account has a password or not: an account with no hash
 * is claimed by the first sign-in, and this is that sign-in. There is no separate
 * registration shape because there is no registration.
 */
export const signInSchema = z.object({
  email: z.string().min(1).max(320),
  // Long enough to be worth having, and bounded because PBKDF2 will hash whatever it
  // is handed and a megabyte of it is a way to spend the server's time.
  password: z.string().min(8).max(1024),
})

export type SignIn = z.infer<typeof signInSchema>

/** Who you are. The only thing the browser is told about an account. */
export const sessionSchema = z.object({
  email: z.string(),
})

export type Session = z.infer<typeof sessionSchema>

/** What a 4xx carries. One shape, so the browser has one thing to render. */
export const apiErrorSchema = z.object({
  error: z.string(),
  /** Field-level detail when the failure came from parsing the filter. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>
