import { z } from 'zod'
import { formatTagTerm, parseTagTerm, type TagTerm } from './tags.ts'

/**
 * THE filter serialization.
 *
 * One definition of what "the current filter" means, imported by the server and the
 * browser alike, so every endpoint and every panel agree by construction rather than
 * by discipline. This is the single biggest reason the stack is one language.
 *
 * Units here are SI — metres, seconds, metres per second — because those are the
 * column units. Nothing converts on the way in, so the boundary has no rounding
 * question; the browser converts for display, which it has to do anyway.
 */

/**
 * The four range facets. One list drives the URL codec, the SQL and the sidebar, so
 * a fifth range is a line here rather than a fifth implementation of the same idea.
 */
export const RANGE_KEYS = ['distance', 'elevation', 'duration', 'speed'] as const
export type RangeKey = (typeof RANGE_KEYS)[number]

export const SORT_KEYS = ['date', ...RANGE_KEYS] as const
export type SortKey = (typeof SORT_KEYS)[number]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/** Both ends optional and independent: an absent bound simply means unbounded. */
const rangeSchema = z.object({
  min: z.number().nullable(),
  max: z.number().nullable(),
})

const tagTermSchema = z.string().transform((raw, ctx): TagTerm => {
  const term = parseTagTerm(raw)
  if (!term) {
    ctx.addIssue({ code: 'custom', message: `'${raw}' is not a tag filter term` })
    return z.NEVER
  }
  return term
})

/** `minLon,minLat,maxLon,maxLat` — GeoJSON order, as MapLibre reports bounds. */
const bboxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([w, s, e, n]) => w <= e && s <= n, 'bbox min must not exceed max')

const shape = z.object({
  tags: z.array(tagTermSchema),
  /**
   * Free text, matched against the title. A filter term like any other — it is what
   * finds the untagged ride by the name you gave it, which is where tagging starts.
   */
  q: z.string().nullable(),
  /** Local dates, compared against the activity's own local date. Inclusive. */
  from: isoDate.nullable(),
  to: isoDate.nullable(),
  bbox: bboxSchema.nullable(),
  ranges: z.object({
    distance: rangeSchema,
    elevation: rangeSchema,
    duration: rangeSchema,
    speed: rangeSchema,
  }),
  sortKey: z.enum(SORT_KEYS),
  sortOrder: z.enum(['asc', 'desc']),
})

export type Filter = z.infer<typeof shape>

/**
 * The empty filter: everything, newest first. Also the shape `formatFilter` compares
 * against, so a default never reaches the URL.
 */
export function emptyFilter(): Filter {
  return {
    tags: [],
    q: null,
    from: null,
    to: null,
    bbox: null,
    ranges: {
      distance: { min: null, max: null },
      elevation: { min: null, max: null },
      duration: { min: null, max: null },
      speed: { min: null, max: null },
    },
    sortKey: 'date',
    sortOrder: 'desc',
  }
}

function num(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  // NaN would otherwise sail through `z.number()` and become a WHERE that matches
  // nothing, which is indistinguishable from a filter that legitimately matches
  // nothing. Rejecting here makes a typo a 400.
  return Number.isFinite(value) ? value : Number.NaN
}

/** Accepts what a URL, a Request or a browser location can hand over. */
function asSearchParams(input: unknown): URLSearchParams {
  if (input instanceof URLSearchParams) return input
  if (typeof input === 'string') return new URLSearchParams(input)
  if (input instanceof URL) return input.searchParams
  return new URLSearchParams()
}

/**
 * Zod reaches all the way to the URL: the preprocess step only *shapes* the raw
 * strings, and every rule about what is acceptable lives in the schema, so a
 * malformed URL is a field-level message rather than an undefined three frames on.
 */
export const filterSchema = z.preprocess((input) => {
  // A caller that already holds a Filter-shaped object passes straight through, which
  // is what lets the server re-validate its own reconstruction in tests.
  if (input !== null && typeof input === 'object' && !(input instanceof URLSearchParams)) {
    if ('ranges' in input) return input
  }

  const params = asSearchParams(input)
  const bbox = params.get('bbox')

  const q = params.get('q')

  return {
    tags: params.getAll('tag'),
    // Whitespace is not a search: it would narrow nothing and hold a chip saying so.
    q: q === null || q.trim() === '' ? null : q,
    from: params.get('from'),
    to: params.get('to'),
    bbox: bbox === null || bbox.trim() === '' ? null : bbox.split(',').map(Number),
    ranges: Object.fromEntries(
      RANGE_KEYS.map((key) => [
        key,
        { min: num(params, `${key}_min`), max: num(params, `${key}_max`) },
      ]),
    ),
    sortKey: params.get('sort_key') ?? 'date',
    sortOrder: params.get('sort_order') ?? 'desc',
  }
}, shape)

export function parseFilter(input: unknown): Filter {
  return filterSchema.parse(input)
}

/**
 * The inverse. Defaults are omitted rather than written, so the empty filter is the
 * empty query string and two equal filters produce byte-identical URLs — the same
 * property sorted tag arrays give a re-imported row.
 */
export function formatFilter(filter: Filter): URLSearchParams {
  const params = new URLSearchParams()

  for (const term of filter.tags) params.append('tag', formatTagTerm(term))
  if (filter.q !== null) params.set('q', filter.q)
  if (filter.from !== null) params.set('from', filter.from)
  if (filter.to !== null) params.set('to', filter.to)
  if (filter.bbox !== null) params.set('bbox', filter.bbox.join(','))

  for (const key of RANGE_KEYS) {
    const { min, max } = filter.ranges[key]
    if (min !== null) params.set(`${key}_min`, String(min))
    if (max !== null) params.set(`${key}_max`, String(max))
  }

  if (filter.sortKey !== 'date') params.set('sort_key', filter.sortKey)
  if (filter.sortOrder !== 'desc') params.set('sort_order', filter.sortOrder)

  return params
}

/**
 * Browser-only view state, kept out of `Filter` on purpose: the server has no use
 * for which type you are colouring by, and letting it into the filter would make it
 * a cache key for queries it cannot change.
 */
const viewShape = z.object({
  /** A registry type name, `year`, or null to fall back to the registry's first. */
  colourBy: z.string().nullable(),
  activity: z.number().int().positive().nullable(),
  /**
   * Whether the map collapses nearby starts into clusters at low zoom.
   *
   * View state rather than a filter — it changes nothing about which activities
   * match — but it belongs in the URL for the same reason *colour by* does: it
   * changes what a shared link shows you.
   */
  grouped: z.boolean(),
  /**
   * Which basemap is under the tracks. View state for the same reason as the rest:
   * it changes what a shared link shows without changing which activities match.
   */
  basemap: z.enum(['map', 'satellite']),
})

export type View = z.infer<typeof viewShape>

export const viewSchema = z.preprocess((input) => {
  const params = asSearchParams(input)
  const activity = params.get('activity')

  return {
    colourBy: params.get('colour_by'),
    activity: activity === null || activity.trim() === '' ? null : Number(activity),
    // Grouping is the default, so only its absence is worth writing down.
    grouped: params.get('grouped') !== '0',
    // As is the vector map, so only satellite is.
    basemap: params.get('basemap') === 'satellite' ? 'satellite' : 'map',
  }
}, viewShape)

export function parseView(input: unknown): View {
  return viewSchema.parse(input)
}

export function formatView(view: View): URLSearchParams {
  const params = new URLSearchParams()
  if (view.colourBy !== null) params.set('colour_by', view.colourBy)
  if (view.activity !== null) params.set('activity', String(view.activity))
  if (!view.grouped) params.set('grouped', '0')
  if (view.basemap === 'satellite') params.set('basemap', 'satellite')
  return params
}

/** The whole URL: filters first, then view state, in one stable order. */
export function formatSearch(filter: Filter, view: View): string {
  const params = formatFilter(filter)
  for (const [key, value] of formatView(view)) params.set(key, value)
  return params.toString()
}
