import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core'

/**
 * Activity metadata. Service-reported metrics are stored verbatim; anything else
 * (segment distances, cross-service-consistent totals) is computed from trackpoints
 * on demand.
 */
export const activities = sqliteTable(
  'activities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Free-form source name. The schema deliberately does not enumerate sources. */
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title'),
    /** UTC instant, ISO8601. */
    startedAt: text('started_at').notNull(),
    /** Seconds east of UTC, derived from the track's own coordinates. */
    utcOffset: integer('utc_offset').notNull(),
    distanceM: real('distance_m'),
    /** Moving time. */
    durationS: integer('duration_s'),
    /** Wall clock, start to finish. */
    elapsedS: integer('elapsed_s'),
    elevationGainM: real('elevation_gain_m'),
    /** Simplified track, encoded polyline. What the map renders. */
    polyline: text('polyline'),
    /** JSON array of tag names. Queried with json_each(). */
    tags: text('tags').notNull().default('[]'),
  },
  (t) => [unique('activities_source_external').on(t.source, t.externalId)],
)

/**
 * Full-resolution track. `seq` is the authoritative ordering, not `recordedAt` —
 * timestamps can repeat or be absent.
 */
export const trackpoints = sqliteTable(
  'trackpoints',
  {
    activityId: integer('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    lat: real('lat').notNull(),
    lon: real('lon').notNull(),
    /** Height above sea level, not cumulative gain. */
    altitudeM: real('altitude_m'),
    /** Unix epoch seconds, UTC. */
    recordedAt: integer('recorded_at'),
  },
  (t) => [
    primaryKey({ columns: [t.activityId, t.seq] }),
    // Covering index: the spatial bbox query is answered from the index alone.
    index('trackpoints_spatial').on(t.lat, t.lon, t.activityId),
  ],
)
