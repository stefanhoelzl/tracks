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
 * A line of the response stream.
 *
 * NDJSON rather than SSE framing: `EventSource` is GET-only and could carry neither
 * the credentials nor the payload, so the stream was never going to be one. What is
 * left is a body of JSON lines, which needs no framing to explain.
 */
export const importProgressSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('progress'),
    written: z.number().int(),
    /** The activity being written, for the line under the bar. */
    title: z.string().nullable(),
  }),
  z.object({
    type: z.literal('done'),
    written: z.number().int(),
    failed: z.array(importFailureSchema),
    /** Enum values a source derived that the registry had lost, and got back. */
    readdedValues: z.array(z.string()),
    /** Derived tags no registry type could accept, counted by tag. */
    rejectedTags: z.array(z.tuple([z.string(), z.number().int()])),
  }),
  /**
   * The run died after the response had already begun, so there is no status code
   * left to say it with. The transaction is rolled back before this is sent.
   */
  z.object({ type: z.literal('error'), message: z.string() }),
])

export type ImportProgress = z.infer<typeof importProgressSchema>
