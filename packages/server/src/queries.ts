import polyline from '@mapbox/polyline'
import {
  type ActivityDetailResponse,
  type ActivityRow,
  type FacetsResponse,
  type Filter,
  parseTag,
  RANGE_KEYS,
  type RangeFacet,
  type RangeKey,
  type TagRegistry,
  type TagTypesResponse,
  type TracksResponse,
} from '@tracks/core'
import { sql } from 'drizzle-orm'
import type { Conn, Db } from './db.ts'
import {
  LOCAL_DATE,
  type Owner,
  orderFor,
  RANGE_EXPR,
  type Scope,
  SPEED,
  whereFor,
} from './query.ts'

/** Enough bars to show a distribution, few enough to stay legible at 300 px wide. */
const BUCKET_COUNT = 24

interface RawRow {
  id: number
  source: string
  title: string | null
  started_at: string
  utc_offset: number
  local_date: string
  distance_m: number | null
  duration_s: number | null
  elapsed_s: number | null
  elevation_gain_m: number | null
  speed_ms: number | null
  tags: string
}

const ROW_COLUMNS = sql`
  a.id, a.source, a.title, a.started_at, a.utc_offset,
  ${LOCAL_DATE} AS local_date,
  a.distance_m, a.duration_s, a.elapsed_s, a.elevation_gain_m,
  ${SPEED} AS speed_ms, a.tags`

function toRow(raw: RawRow): ActivityRow {
  return {
    id: raw.id,
    source: raw.source,
    title: raw.title,
    startedAt: raw.started_at,
    utcOffset: raw.utc_offset,
    localDate: raw.local_date,
    distanceM: raw.distance_m,
    durationS: raw.duration_s,
    elapsedS: raw.elapsed_s,
    elevationGainM: raw.elevation_gain_m,
    speedMs: raw.speed_ms,
    tags: JSON.parse(raw.tags) as string[],
  }
}

/**
 * Resolve a filter's bounding box to the activities it selects, once.
 *
 * Every route calls this before building any SQL, so the trackpoint query runs once
 * per request no matter how many WHERE clauses the route goes on to build.
 */
export function scopeFor(db: Conn, owner: Owner, filter: Filter): Scope {
  const { userId } = owner
  if (filter.bbox === null) return { userId, filter, bboxIds: null }

  const [west, south, east, north] = filter.bbox
  // Two stages, and the first is what makes the second cheap: the cached bounding boxes
  // discard almost every activity by comparing four numbers, so the exact point test runs
  // over the few that could possibly match. A box overlapping the viewport is not a track
  // entering it — a ride whose box spans a city it only skirted is eliminated here — so
  // the second stage is what the answer actually rests on.
  const rows = db.all<{ activity_id: number }>(sql`
    SELECT DISTINCT activity_id FROM trackpoints
    WHERE activity_id IN (
      SELECT id FROM activities
      WHERE user_id = ${userId}
        AND min_lat <= ${north} AND max_lat >= ${south}
        AND min_lon <= ${east} AND max_lon >= ${west})
      AND lat BETWEEN ${south} AND ${north} AND lon BETWEEN ${west} AND ${east}`)

  return { userId, filter, bboxIds: rows.map((row) => row.activity_id) }
}

export function listActivities(db: Db, scope: Scope): ActivityRow[] {
  const rows = db.all<RawRow>(sql`
    SELECT ${ROW_COLUMNS} FROM activities a
    WHERE ${whereFor(scope)}
    ORDER BY ${orderFor(scope.filter)}`)

  return rows.map(toRow)
}

/**
 * The map's payload: the stored polyline, handed over as-is.
 *
 * Decoding here produced ~50k coordinate arrays per response and cost more in
 * `JSON.stringify` alone than the query did. The browser rebuilds every feature anyway to
 * bake in a colour, so the decode goes where that pass already is.
 */
export function listTracks(db: Db, scope: Scope): TracksResponse {
  const rows = db.all<{ id: number; polyline: string; local_date: string; tags: string }>(sql`
    SELECT a.id, a.polyline, ${LOCAL_DATE} AS local_date, a.tags FROM activities a
    WHERE ${whereFor(scope)} AND a.polyline IS NOT NULL
    ORDER BY ${orderFor(scope.filter)}`)

  return {
    tracks: rows.map((row) => ({
      id: row.id,
      polyline: row.polyline,
      tags: JSON.parse(row.tags) as string[],
      year: Number(row.local_date.slice(0, 4)),
    })),
  }
}

/** Lossless for six-decimal trackpoints, unlike the default 5. */
const DETAIL_PRECISION = 6

export function activityDetail(db: Db, owner: Owner, id: number): ActivityDetailResponse | null {
  const raw = db.get<RawRow>(sql`
    SELECT ${ROW_COLUMNS} FROM activities a
    WHERE a.id = ${id} AND a.user_id = ${owner.userId}`)
  // Not "no such activity" but "not yours, or no such activity" — the route turns both
  // into the same 404, because telling them apart is telling a stranger what exists.
  if (!raw) return null

  // The owner is not repeated here: the row above established that this activity is
  // theirs, and a track is reached only through its activity.

  const points = db.all<{ lat: number; lon: number; altitude_m: number | null }>(sql`
    SELECT lat, lon, altitude_m FROM trackpoints
    WHERE activity_id = ${id} ORDER BY seq`)

  return {
    activity: toRow(raw),
    track: {
      polyline: polyline.encode(
        points.map((p) => [p.lat, p.lon] as [number, number]),
        DETAIL_PRECISION,
      ),
      altitudeM: points.map((p) => p.altitude_m),
    },
  }
}

/**
 * Equal-width buckets over the observed span.
 *
 * Bucketed here rather than in SQL because the edge cases — a single distinct value,
 * the maximum landing one past the last bucket — are three lines of JavaScript and a
 * paragraph of `CASE` otherwise, over a few hundred numbers either way.
 */
function bucket(values: number[]): RangeFacet {
  if (values.length === 0) return { min: null, max: null, buckets: [] }

  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return { min, max, buckets: [values.length] }

  const buckets = new Array<number>(BUCKET_COUNT).fill(0)
  const width = (max - min) / BUCKET_COUNT
  for (const value of values) {
    // The maximum would otherwise index one past the end.
    const index = Math.min(BUCKET_COUNT - 1, Math.floor((value - min) / width))
    buckets[index]!++
  }
  return { min, max, buckets }
}

function rangeFacet(db: Db, scope: Scope, key: RangeKey): RangeFacet {
  const rows = db.all<{ v: number }>(sql`
    SELECT ${RANGE_EXPR[key]} AS v FROM activities a
    WHERE ${whereFor(scope, { range: key })} AND ${RANGE_EXPR[key]} IS NOT NULL`)

  return bucket(rows.map((r) => r.v))
}

/**
 * The registry, with each type's values in use counted over every activity of theirs.
 *
 * Deliberately unfiltered, unlike every other count in the app — unfiltered, not
 * unscoped: it takes an `Owner` rather than a `Scope` precisely because the one thing
 * it must not ignore is whose activities it is counting. It is what the
 * autocomplete offers — which must include the values nothing currently matching
 * carries, since narrowing to the untagged is how tagging starts — and what the colour
 * layout is built from, which must not depend on where the map is pointed.
 */
export function tagVocabulary(db: Db, owner: Owner, registry: TagRegistry): TagTypesResponse {
  const counted = db.all<{ tag: string; n: number }>(sql`
    SELECT t.value AS tag, count(*) AS n
    FROM activities a, json_each(a.tags) t
    WHERE a.user_id = ${owner.userId}
    GROUP BY t.value`)

  const byType = new Map<string, Array<{ value: string; count: number }>>()
  for (const row of counted) {
    const tag = parseTag(row.tag)
    if (!tag) continue
    const values = byType.get(tag.type)
    const entry = { value: tag.value, count: row.n }
    if (values) values.push(entry)
    else byType.set(tag.type, [entry])
  }

  return {
    tagTypes: [...registry.values()]
      .sort((a, b) => a.sort - b.sort)
      .map((type) => ({
        ...type,
        values: (byType.get(type.name) ?? []).sort((a, b) => b.count - a.count),
      })),
  }
}

export function facets(db: Db, scope: Scope, registry: TagRegistry): FacetsResponse {
  const summary = db.get<{ n: number; d: number; e: number; t: number }>(sql`
    SELECT count(*) AS n,
           coalesce(sum(a.distance_m), 0) AS d,
           coalesce(sum(a.elevation_gain_m), 0) AS e,
           coalesce(sum(a.duration_s), 0) AS t
    FROM activities a WHERE ${whereFor(scope)}`)!

  // Bounds over the cached per-activity boxes, with the viewport term dropped — 197 rows
  // of four numbers, so it rides along with the other aggregates for nothing.
  const box = db.get<{
    w: number | null
    s: number | null
    e: number | null
    n: number | null
  }>(sql`
    SELECT min(a.min_lon) AS w, min(a.min_lat) AS s,
           max(a.max_lon) AS e, max(a.max_lat) AS n
    FROM activities a WHERE ${whereFor(scope, { bbox: true })}`)!

  const extent: [number, number, number, number] | null =
    box.w === null || box.s === null || box.e === null || box.n === null
      ? null
      : [box.w, box.s, box.e, box.n]

  const tags = [...registry.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((type) => {
      const prefix = `${type.name}:`
      const where = whereFor(scope, { tagType: type.name })

      const counted = db.all<{ v: string; n: number }>(sql`
        SELECT substr(t.value, ${prefix.length + 1}) AS v, count(*) AS n
        FROM activities a, json_each(a.tags) t
        WHERE ${where} AND substr(t.value, 1, ${prefix.length}) = ${prefix}
        GROUP BY t.value`)

      // What exists, commonest first. No type declares a vocabulary any more, so there
      // is no order to preserve and no value to show at zero — a value with no
      // activities is not a value.
      const values = counted
        .map((r) => ({ value: r.v, count: r.n }))
        .sort((a, b) => b.count - a.count)

      const notSet = db.get<{ n: number }>(sql`
        SELECT count(*) AS n FROM activities a
        WHERE ${where} AND NOT EXISTS (
          SELECT 1 FROM json_each(a.tags) WHERE substr(value, 1, ${prefix.length}) = ${prefix}
        )`)!

      return { type: type.name, values, notSet: notSet.n }
    })

  return {
    summary: {
      count: summary.n,
      distanceM: summary.d,
      elevationGainM: summary.e,
      durationS: summary.t,
    },
    extent,
    tags,
    ranges: Object.fromEntries(
      RANGE_KEYS.map((key) => [key, rangeFacet(db, scope, key)]),
    ) as FacetsResponse['ranges'],
  }
}
