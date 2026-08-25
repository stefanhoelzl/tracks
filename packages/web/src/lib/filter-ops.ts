import type { Filter, RangeKey, TagTerm } from '@tracks/core'
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

export function setDates(filter: Filter, from: string | null, to: string | null): Filter {
  return { ...filter, from, to }
}

export function setBbox(filter: Filter, bbox: Filter['bbox']): Filter {
  return { ...filter, bbox }
}

/** True when anything at all is narrowing the results — what the *clear* button needs. */
export function isNarrowed(filter: Filter): boolean {
  return (
    filter.tags.length > 0 ||
    filter.from !== null ||
    filter.to !== null ||
    filter.bbox !== null ||
    Object.values(filter.ranges).some((r) => r.min !== null || r.max !== null)
  )
}

/** Which facets an empty result can be blamed on, in the words the sidebar uses. */
export function narrowingFacets(filter: Filter, labels: Map<string, string>): string[] {
  const names: string[] = []

  for (const type of new Set(filter.tags.map((t) => t.type))) {
    names.push(labels.get(type) ?? type)
  }
  if (filter.from !== null || filter.to !== null) names.push('Date range')
  if (filter.bbox !== null) names.push('This area')

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
