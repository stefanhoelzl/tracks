import type { Filter, RangeKey, SortKey, TagTerm } from '@tracks/core'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Filter → SQL.
 *
 * The grammar lives in `packages/core` because both ends speak it; the translation
 * lives here because only one end has a database. Hand-written SQL rather than the
 * query builder, for the same reason the spatial and aggregate queries are: what is
 * being expressed — `json_each` existence, a local-date shift, a derived speed — is
 * clearer as SQL than as the calls that would generate it.
 */

/**
 * The activity's own local date, computed inline. Storing it would be denormalization
 * that can drift, and no scan over a few hundred rows needs an index.
 */
export const LOCAL_DATE = sql`date(a.started_at, a.utc_offset || ' seconds')`

/**
 * Metres per second. `nullif` makes a zero moving time null rather than an error,
 * which is what keeps a broken row out of the speed facet instead of failing the
 * query for every other row.
 */
export const SPEED = sql`(a.distance_m / nullif(a.duration_s, 0))`

const RANGE_EXPR: Record<RangeKey, SQL> = {
  distance: sql`a.distance_m`,
  elevation: sql`a.elevation_gain_m`,
  duration: sql`a.duration_s`,
  speed: SPEED,
}

const SORT_EXPR: Record<SortKey, SQL> = {
  date: sql`a.started_at`,
  ...RANGE_EXPR,
}

/**
 * Which facet's own terms to leave out.
 *
 * Self-exclusion is the whole reason this parameter exists: a facet counted with its
 * own selection applied reports zero for every value you did not pick, which turns
 * the sidebar into a dead end. Excluding by *tag type* rather than wholesale is what
 * keeps an active trip filter narrowing the sport counts.
 */
export interface Exclusion {
  tagType?: string
  range?: RangeKey
  date?: boolean
  bbox?: boolean
}

/** `substr` rather than `LIKE 'type:%'` — a type name may contain `_`, a LIKE wildcard. */
function hasType(type: string): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(a.tags) WHERE substr(value, 1, ${type.length + 1}) = ${`${type}:`})`
}

function hasTag(tag: string): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(a.tags) WHERE value = ${tag})`
}

/**
 * One type's terms: positives OR together, negatives AND on top.
 *
 * `trip:` — an empty value — is *absence*, and it joins the OR as one more selectable
 * value, which is exactly how the sidebar draws it: `bike or hike or not set`. Negated,
 * it inverts to "has some trip", which the grammar can express because an empty value
 * is forbidden everywhere else.
 */
function tagTypeCondition(terms: TagTerm[]): SQL | null {
  const positives = terms.filter((t) => !t.negated)
  const negatives = terms.filter((t) => t.negated)

  const parts: SQL[] = []

  if (positives.length > 0) {
    const alternatives = positives.map((t) =>
      t.value === null ? sql`NOT ${hasType(t.type)}` : hasTag(`${t.type}:${t.value}`),
    )
    parts.push(sql`(${sql.join(alternatives, sql` OR `)})`)
  }

  for (const term of negatives) {
    parts.push(
      term.value === null ? hasType(term.type) : sql`NOT ${hasTag(`${term.type}:${term.value}`)}`,
    )
  }

  if (parts.length === 0) return null
  return sql`(${sql.join(parts, sql` AND `)})`
}

/**
 * The WHERE body for a filter, as a fragment expecting `activities a` in scope.
 *
 * Always returns something truthy so callers can interpolate it unconditionally —
 * an empty filter is `1 = 1`, not a hole in the statement.
 */
export function whereFor(filter: Filter, exclude: Exclusion = {}): SQL {
  const parts: SQL[] = []

  const byType = new Map<string, TagTerm[]>()
  for (const term of filter.tags) {
    if (term.type === exclude.tagType) continue
    const existing = byType.get(term.type)
    if (existing) existing.push(term)
    else byType.set(term.type, [term])
  }
  for (const terms of byType.values()) {
    const condition = tagTypeCondition(terms)
    if (condition) parts.push(condition)
  }

  if (!exclude.date) {
    if (filter.from !== null) parts.push(sql`${LOCAL_DATE} >= ${filter.from}`)
    if (filter.to !== null) parts.push(sql`${LOCAL_DATE} <= ${filter.to}`)
  }

  if (!exclude.bbox && filter.bbox !== null) {
    const [west, south, east, north] = filter.bbox
    // Exact, and answered from the covering index alone. The only theoretical gap —
    // a track crossing the box with no sampled point inside — is irrelevant at
    // one-second sampling.
    parts.push(sql`a.id IN (
      SELECT DISTINCT activity_id FROM trackpoints
      WHERE lat BETWEEN ${south} AND ${north} AND lon BETWEEN ${west} AND ${east}
    )`)
  }

  for (const key of Object.keys(RANGE_EXPR) as RangeKey[]) {
    if (key === exclude.range) continue
    const { min, max } = filter.ranges[key]
    // A null column fails both comparisons, so an activity with no distance is absent
    // from a distance range without a word being said about it — and present when no
    // bound is set, which is what keeps narrowing monotonic.
    if (min !== null) parts.push(sql`${RANGE_EXPR[key]} >= ${min}`)
    if (max !== null) parts.push(sql`${RANGE_EXPR[key]} <= ${max}`)
  }

  if (parts.length === 0) return sql`1 = 1`
  return sql.join(parts, sql` AND `)
}

/** `id` breaks ties, so two activities with equal distance never swap between requests. */
export function orderFor(filter: Filter): SQL {
  const direction = filter.sortOrder === 'asc' ? sql`ASC` : sql`DESC`
  return sql`${SORT_EXPR[filter.sortKey]} ${direction}, a.id DESC`
}

export { RANGE_EXPR }
