import { z } from 'zod'

/**
 * The import contract.
 *
 * The browser reads Strava and Komoot; the server writes what it is handed. So this
 * is the whole of what the server knows about where an activity came from — a `source`
 * string, and finished `<type>:<value>` tags the source derived. There is no allow-list:
 * `source` is the same free-form name the upsert key has always used, and a third
 * source should not need a server change to exist.
 *
 * Geometry travels encoded for the same reason the detail route encodes it: 34k
 * `{lat, lon, altitudeM, recordedAt}` objects is 2.65 MB of JSON overhead for 0.30 MB
 * of resolution.
 */

/** Precision 6 is lossless for GPS coordinates, and what the detail route already uses. */
export const IMPORT_PRECISION = 6

export const importFrameSchema = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  title: z.string().nullable(),
  /** UTC instant, ISO8601. */
  startedAt: z.string().min(1),
  distanceM: z.number().nullable(),
  /** Moving time. */
  durationS: z.number().int().nullable(),
  /** Wall clock, start to finish. */
  elapsedS: z.number().int().nullable(),
  elevationGainM: z.number().nullable(),
  /** Finished tags the source derived. Validated against the registry on arrival. */
  tags: z.array(z.string()),
  /** Full-resolution `[lat, lon]`, encoded at `IMPORT_PRECISION`. */
  geometry: z.string().min(1),
  /**
   * Metres above sea level, one per point — or null for a track that carries no
   * elevation at all, which is one word on the wire instead of 25,000 of them.
   */
  altitudes: z.array(z.number().nullable()).nullable(),
  /**
   * Seconds since `startedAt`, one per point, or null for a track with no real
   * timing. Relative rather than absolute because a four-digit offset is half the
   * bytes of a ten-digit epoch, and the server has `startedAt` anyway.
   */
  times: z.array(z.number().int().nullable()).nullable(),
})

export type ImportFrame = z.infer<typeof importFrameSchema>

/**
 * What the client offers, and what the server wants back.
 *
 * A pure query — it takes no lock and leaves nothing behind, so an abandoned dialog
 * costs nothing and asking twice is safe. Inverted deliberately: the client sends its
 * candidates rather than the server publishing every id it holds.
 */
export const importSelectRequestSchema = z.object({
  source: z.string().min(1),
  ids: z.array(z.string().min(1)),
})

export const importSelectResponseSchema = z.object({
  /** The subset the server has no track for. Everything else is already here. */
  wanted: z.array(z.string()),
})

export type ImportSelectRequest = z.infer<typeof importSelectRequestSchema>
export type ImportSelectResponse = z.infer<typeof importSelectResponseSchema>

/** One activity failed; the run carries on. Reported by whichever side hit it. */
export const importFailureSchema = z.object({
  externalId: z.string(),
  error: z.string(),
})

export type ImportFailure = z.infer<typeof importFailureSchema>

/**
 * What one activity's write answers with.
 *
 * There is no progress stream any more, because there is no run to report progress
 * about: the browser sends one activity per request and the response *is* the progress.
 * A 200 means it landed; a 400 carries the reason it did not, and costs that activity
 * and nothing else — the run carries on, and `selectWanted` makes the next attempt skip
 * everything that did land.
 */
export const importActivityResponseSchema = z.object({
  /** Derived tags no registry type could accept, counted by tag. */
  rejectedTags: z.array(z.tuple([z.string(), z.number().int()])),
})

export type ImportActivityResponse = z.infer<typeof importActivityResponseSchema>
