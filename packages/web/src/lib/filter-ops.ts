import { type Filter, RANGE_KEYS, type RangeKey, type TagTerm } from '@tracks/core'
import type { RowState } from '../components/ui/ValueRow.tsx'

/**
 * Filter edits, as pure functions.
 *
 * Kept out of the components so the rules a facet row implies — that including a
 * value drops its exclusion, that a third click clears rather than cycling forever —
 * are stated once and testable without rendering anything.
 */

/** `null` for the *not set* row, whose term is the type with an empty value. */
export function termState(filter: Filter, type: string, value: string | null): RowState {
  const term = filter.tags.find((t) => t.type === type && t.value === value)
  if (!term) return 'off'
  return term.negated ? 'exclude' : 'include'
}

function without(tags: TagTerm[], type: string, value: string | null): TagTerm[] {
  return tags.filter((t) => !(t.type === type && t.value === value))
}

/** Off → include → off. Including drops any exclusion of the same value. */
export function toggleTag(filter: Filter, type: string, value: string | null): Filter {
  const state = termState(filter, type, value)
  const rest = without(filter.tags, type, value)

  return {
    ...filter,
    tags: state === 'include' ? rest : [...rest, { type, value, negated: false }],
  }
}

/** Off → exclude → off, and excluding drops any inclusion of the same value. */
export function excludeTag(filter: Filter, type: string, value: string | null): Filter {
  const state = termState(filter, type, value)
  const rest = without(filter.tags, type, value)

  return {
    ...filter,
    tags: state === 'exclude' ? rest : [...rest, { type, value, negated: true }],
  }
}

export function setRange(
  filter: Filter,
  key: RangeKey,
  bounds: { min: number | null; max: number | null },
): Filter {
  return { ...filter, ranges: { ...filter.ranges, [key]: bounds } }
}

/** Blank is not a search — it would hold a chip that narrows nothing. */
export function setSearch(filter: Filter, q: string): Filter {
  return { ...filter, q: q.trim() === '' ? null : q }
}

export function setDates(filter: Filter, from: string | null, to: string | null): Filter {
  return { ...filter, from, to }
}

/**
 * One end of the custom range, where setting the first end sets both.
 *
 * A range is entered left to right, and the second picker opening on today — months
 * away from the day just chosen — makes you navigate back to where you already were.
 * So the first date entered is a single day, and the other end widens it. Clearing an
 * end clears only that end: unbounded is a thing you can mean.
 */
export function setDateBound(filter: Filter, end: 'from' | 'to', value: string | null): Filter {
  if (value === null)
    return setDates(filter, end === 'from' ? null : filter.from, end === 'to' ? null : filter.to)

  return end === 'from'
    ? setDates(filter, value, filter.to ?? value)
    : setDates(filter, filter.from ?? value, value)
}

export function setBbox(filter: Filter, bbox: Filter['bbox']): Filter {
  return { ...filter, bbox }
}

/**
 * True when anything at all is narrowing the results — what the *clear* button needs.
 *
 * The bbox is not among them. It is always set and cannot be cleared, so counting it
 * would leave *clear* permanently lit and promising something it does not do.
 */
export function isNarrowed(filter: Filter): boolean {
  return (
    filter.tags.length > 0 ||
    filter.q !== null ||
    filter.from !== null ||
    filter.to !== null ||
    Object.values(filter.ranges).some((r) => r.min !== null || r.max !== null)
  )
}

/** Which facets an empty result can be blamed on, in the words the sidebar uses. */
export function narrowingFacets(filter: Filter, labels: Map<string, string>): string[] {
  const names: string[] = []

  for (const type of new Set(filter.tags.map((t) => t.type))) {
    names.push(labels.get(type) ?? type)
  }
  if (filter.q !== null) names.push('Search')
  if (filter.from !== null || filter.to !== null) names.push('Date range')

  const rangeLabels: Record<RangeKey, string> = {
    distance: 'Distance',
    elevation: 'Elevation gain',
    duration: 'Duration',
    speed: 'Average speed',
  }
  for (const [key, bounds] of Object.entries(filter.ranges) as Array<
    [RangeKey, { min: number | null; max: number | null }]
  >) {
    if (bounds.min !== null || bounds.max !== null) names.push(rangeLabels[key])
  }

  return names
}

/**
 * The active filter, as a list of removable things.
 *
 * Derived here rather than in the top bar so the rules — what counts as active, what
 * removing one leaves behind — are stated once and can be tested without rendering.
 * Each term carries the filter it would leave, so the caller never has to know how a
 * date range differs from a tag.
 */
export interface ActiveTerm {
  /** Stable across renders, so React keeps the chip rather than rebuilding it. */
  key: string
  /** The badge: a type name for a tag, a facet name otherwise. */
  facet: string
  value: string
  /** Set for tag terms, so the chip can take the value's own colour. */
  tag?: { type: string; value: string | null }
  negated: boolean
  without: Filter
}

export function activeTerms(
  filter: Filter,
  labels: Map<string, string>,
  units: Record<RangeKey, { label: string; unit: string; format: (v: number) => string }>,
): ActiveTerm[] {
  const terms: ActiveTerm[] = []

  for (const term of filter.tags) {
    terms.push({
      key: `tag:${formatTermKey(term)}`,
      facet: labels.get(term.type) ?? term.type,
      value: term.value ?? 'not set',
      tag: { type: term.type, value: term.value },
      negated: term.negated,
      without: {
        ...filter,
        tags: filter.tags.filter((t) => t !== term),
      },
    })
  }

  if (filter.q !== null) {
    terms.push({
      key: 'search',
      facet: 'Search',
      value: filter.q,
      negated: false,
      without: { ...filter, q: null },
    })
  }

  if (filter.from !== null || filter.to !== null) {
    terms.push({
      key: 'date',
      facet: 'Date',
      value: `${filter.from ?? '…'} → ${filter.to ?? '…'}`,
      negated: false,
      without: { ...filter, from: null, to: null },
    })
  }

  for (const key of RANGE_KEYS) {
    const { min, max } = filter.ranges[key]
    if (min === null && max === null) continue

    const { label, unit, format } = units[key]
    terms.push({
      key: `range:${key}`,
      facet: label,
      // An open end reads as open rather than as the axis it happens to sit on.
      value: `${min === null ? '…' : format(min)}–${max === null ? '…' : format(max)} ${unit}`,
      negated: false,
      without: { ...filter, ranges: { ...filter.ranges, [key]: { min: null, max: null } } },
    })
  }

  return terms
}

function formatTermKey(term: TagTerm): string {
  return `${term.negated ? '-' : ''}${term.type}:${term.value ?? ''}`
}

/** Presets resolve to dates on click, so the URL never holds a relative range. */
export function datePresets(
  today: Date,
): Array<{ label: string; from: string | null; to: string | null }> {
  const iso = (date: Date) => date.toISOString().slice(0, 10)
  const shifted = (days: number) => {
    const date = new Date(today)
    date.setUTCDate(date.getUTCDate() - days)
    return iso(date)
  }
  const year = today.getUTCFullYear()

  return [
    { label: 'Last 30 days', from: shifted(30), to: iso(today) },
    { label: 'Last 3 months', from: shifted(91), to: iso(today) },
    { label: 'Last 12 months', from: shifted(365), to: iso(today) },
    { label: 'This year', from: `${year}-01-01`, to: iso(today) },
    { label: String(year - 1), from: `${year - 1}-01-01`, to: `${year - 1}-12-31` },
    { label: String(year - 2), from: `${year - 2}-01-01`, to: `${year - 2}-12-31` },
    { label: 'All time', from: null, to: null },
  ]
}
