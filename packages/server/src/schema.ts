import { integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

/**
 * Who the rows belong to.
 *
 * An email rather than a name, because the first sign-in on an account with no hash is
 * what sets its password — and an address nobody can guess is the whole of what makes
 * that safe. Nothing is ever sent to it: it identifies, it does not reach.
 *
 * Accounts are made by hand, so there is no signup route and nothing public that writes
 * here. `password_hash` is null exactly once in a user's life, between the row being
 * created and that first sign-in claiming it.
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  /** PBKDF2, salt and iteration count inline — see `auth.ts`. Null until claimed. */
  passwordHash: text('password_hash'),
})

/**
 * Activity metadata, and the track itself. Service-reported metrics are stored verbatim;
 * anything else (segment distances, cross-service-consistent totals) is computed from the
 * stored track on demand.
 */
export const activities = sqliteTable(
  'activities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Its owner. Every read and every write is scoped by it — see `Owner` in query.ts. */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
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
    /** JSON array of '<type>:<value>' tags, sorted. Queried with json_each(). */
    tags: text('tags').notNull().default('[]'),
    /**
     * The track's bounding box, cached from its trackpoints.
     *
     * The same trade as `polyline`: an aggregate over a track's thousand-odd points,
     * stored once so the common query never reads them. It makes the viewport filter a
     * scan of a few hundred activities that eliminates almost all of them, before the
     * exact point check runs over what survives. Null only for a row imported before
     * this column existed, or one with no track.
     */
    minLat: real('min_lat'),
    maxLat: real('max_lat'),
    minLon: real('min_lon'),
    maxLon: real('max_lon'),
    /**
     * The full-resolution track, in the three encodings the detail route sends.
     *
     * A row per point was 41 bytes to carry about seven of information, and 43.1MB of a
     * 43.5MB database. These three columns are 5.9MB for the same 1.02M points, and the
     * shape is the reason rather than the size: opening an activity was 4,438 rows and
     * 470KB off Frankfurt, and importing one was a row per point — 1.02M of them, on the
     * one metered operation that costs a thousand times more per row than a read.
     *
     * Stored in exactly the form the API sends, so the read path has no codec in it at
     * all. `track_geometry` is a polyline at precision 6, which is what `/api/activities/:id`
     * already encoded on every request; the other two are `encodeScalars` over decimetres
     * and over seconds from `started_at`. Null together, and only for an activity with no
     * track — a dropout inside one is a null *within* a stream, which the codec carries.
     */
    trackGeometry: text('track_geometry'),
    trackAltitudes: text('track_altitudes'),
    trackTimes: text('track_times'),
  },
  // The owner is part of the key: two people may each import the same Strava ride, and
  // one of them importing it must not be the other's duplicate.
  (t) => [unique('activities_source_external').on(t.userId, t.source, t.externalId)],
)

/**
 * The full-resolution track, before it moved onto `activities`.
 *
 * Nothing writes here any more and one thing still reads it: `activityDetail` falls back
 * to it for a row imported before `track_geometry` existed. A one-off script fills those
 * columns and the next migration drops this table, so both the fallback and this comment
 * are the shape of the gap between two deploys.
 *
 * `seq` is the authoritative ordering, not `recordedAt` — timestamps can repeat or be
 * absent.
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
  // The table is WITHOUT ROWID, which drizzle cannot express — see migration 0002.
  // The primary key is therefore the table's own key rather than a second copy of it,
  // which is both how the track is read back and 15MB the database no longer spends.
  (t) => [primaryKey({ columns: [t.activityId, t.seq] })],
)

/**
 * The tag type registry.
 *
 * Types, never values: `trip:Balkan 2026` stays a string in an activity's array, so
 * tagging is one UPDATE and there is nothing to garbage collect. What a type carries
 * is only what a bare string cannot — how to say it, whether an activity may hold more
 * than one, and where it sits in the sidebar.
 *
 * It does not carry a vocabulary, and it does not carry a colour. A type's values are
 * whatever activities have; its colour is hashed from its name, like every value's.
 * What is left is metadata for a type that exists in the data — and only for as long
 * as it does, since a type with no tags left is deleted.
 *
 * A registry per user, because the tags it describes are per user: `trip:` means what
 * one person's activities say it means.
 */
export const tagTypes = sqliteTable(
  'tag_types',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Identifier, and the prefix of every tag of this type. */
    name: text('name').notNull(),
    label: text('label').notNull(),
    singleValued: integer('single_valued', { mode: 'boolean' }).notNull(),
    /** Sidebar order; unique within a registry so it is never ambiguous. */
    sort: integer('sort').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.name] }),
    unique('tag_types_user_sort_unique').on(t.userId, t.sort),
  ],
)
