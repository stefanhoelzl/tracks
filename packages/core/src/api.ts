import { z } from 'zod'
import { RANGE_KEYS } from './filter.ts'
import { tagTypeSchema } from './tags.ts'

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
 * GeoJSON, ready for `source.setData()`. Properties carry the tags and the year so
 * *colour by* is a MapLibre expression over what the payload already holds — changing
 * it repaints without refetching a byte.
 */
export const trackFeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.number().int(),
  geometry: z.object({
    type: z.literal('LineString'),
    coordinates: z.array(z.tuple([z.number(), z.number()])),
  }),
  properties: z.object({
    id: z.number().int(),
    tags: z.array(z.string()),
    year: z.number().int(),
  }),
})

export const tracksResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(trackFeatureSchema),
})

export type TracksResponse = z.infer<typeof tracksResponseSchema>

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
export const trackPointSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  altitudeM: z.number().nullable(),
  recordedAt: z.number().int().nullable(),
})

export const activityDetailSchema = z.object({
  activity: activityRowSchema,
  track: z.array(trackPointSchema),
})

export type ActivityDetail = z.infer<typeof activityDetailSchema>

export const tagTypesResponseSchema = z.object({
  tagTypes: z.array(tagTypeSchema),
})

export type TagTypesResponse = z.infer<typeof tagTypesResponseSchema>

/** What a 4xx carries. One shape, so the browser has one thing to render. */
export const apiErrorSchema = z.object({
  error: z.string(),
  /** Field-level detail when the failure came from parsing the filter. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})

export type ApiError = z.infer<typeof apiErrorSchema>
