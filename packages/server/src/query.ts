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

/**
 * A filter together with the activities its bounding box selects.
 *
 * The bbox is the one predicate that cannot be answered from `activities` alone, and
 * `facets` builds eleven WHERE clauses from a single filter — so resolving it inside
 * `whereFor` ran the same trackpoint query eleven times for one request. Resolving it
 * once and carrying the result makes that impossible to reintroduce by accident.
 *
 * `null` means no bbox filter. An empty array means a bbox that selects nothing, which
 * is a different statement and must not collapse into the first.
 */
export interface Scope {
  readonly filter: Filter
  readonly bboxIds: readonly number[] | null
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
export function whereFor(scope: Scope, exclude: Exclusion = {}): SQL {
  const { filter, bboxIds } = scope
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

  if (filter.q !== null) {
    // `LIKE` is case-insensitive for ASCII in SQLite by default, and at a few hundred
    // titles it is instant — an FTS5 table would be a second copy of the titles, three
    // triggers and a migration to save microseconds. The wildcards are escaped so a
    // title containing `%` searches for the character rather than for everything.
    const pattern = `%${filter.q.replace(/[\\%_]/g, '\\$&')}%`
    // A null title matches nothing, exactly as a null distance is absent from a
    // distance range: the rule that keeps narrowing monotonic.
    parts.push(sql`a.title LIKE ${pattern} ESCAPE '\\'`)
  }

  if (!exclude.date) {
    if (filter.from !== null) parts.push(sql`${LOCAL_DATE} >= ${filter.from}`)
    if (filter.to !== null) parts.push(sql`${LOCAL_DATE} <= ${filter.to}`)
  }

  if (!exclude.bbox && bboxIds !== null) {
    // Already resolved to activity ids, so every clause built from this scope reuses
    // one trackpoint query. The set is bounded by the activity count, which is what
    // keeps it inside SQLite's bound-parameter limit.
    parts.push(
      bboxIds.length === 0
        ? sql`0 = 1`
        : sql`a.id IN (${sql.join(
            bboxIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
    )
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
