import { describe, expect, it } from 'vitest'
import {
  emptyFilter,
  formatFilter,
  formatSearch,
  parseFilter,
  parseView,
  RANGE_KEYS,
} from './filter.ts'

describe('filter serialization', () => {
  it('reads the whole vocabulary', () => {
    const filter = parseFilter(
      'tag=sport:bike&tag=-trip:Balkan 2026&tag=trip:' +
        '&from=2024-01-01&to=2024-12-31' +
        '&bbox=13.68,46.31,13.86,46.44' +
        '&distance_min=0&distance_max=50000&elevation_min=500&duration_max=7200&speed_min=4.2' +
        '&sort_key=distance&sort_order=asc',
    )

    expect(filter.tags).toEqual([
      { type: 'sport', value: 'bike', negated: false },
      { type: 'trip', value: 'Balkan 2026', negated: true },
      { type: 'trip', value: null, negated: false },
    ])
    expect(filter.from).toBe('2024-01-01')
    expect(filter.bbox).toEqual([13.68, 46.31, 13.86, 46.44])
    expect(filter.ranges.distance).toEqual({ min: 0, max: 50000 })
    expect(filter.ranges.elevation).toEqual({ min: 500, max: null })
    expect(filter.ranges.duration).toEqual({ min: null, max: 7200 })
    expect(filter.sortKey).toBe('distance')
    expect(filter.sortOrder).toBe('asc')
  })

  it('treats an empty query string as everything, newest first', () => {
    expect(parseFilter('')).toEqual(emptyFilter())
  })

  it('writes no defaults, so the empty filter is the empty query string', () => {
    expect(formatFilter(emptyFilter()).toString()).toBe('')
  })

  it('round-trips', () => {
    const search =
      'tag=sport%3Abike&tag=-trip%3ABalkan+2026&from=2024-01-01&to=2024-12-31' +
      '&bbox=13.68%2C46.31%2C13.86%2C46.44&distance_min=0&distance_max=50000' +
      '&sort_key=speed&sort_order=asc'

    expect(formatFilter(parseFilter(search)).toString()).toBe(search)
  })

  it('round-trips every range independently', () => {
    for (const key of RANGE_KEYS) {
      const filter = parseFilter(`${key}_min=1&${key}_max=2`)
      expect(filter.ranges[key]).toEqual({ min: 1, max: 2 })
      expect(formatFilter(filter).toString()).toBe(`${key}_min=1&${key}_max=2`)
    }
  })

  it('keeps a value that contains a colon or a space intact', () => {
    const filter = parseFilter('tag=trip%3ABalkan%3A%202026')
    expect(filter.tags[0]).toEqual({ type: 'trip', value: 'Balkan: 2026', negated: false })
    expect(formatFilter(filter).get('tag')).toBe('trip:Balkan: 2026')
  })

  it('rejects a malformed tag term by naming it', () => {
    expect(() => parseFilter('tag=alps')).toThrow(/not a tag filter term/)
  })

  it('rejects a date that is not a date', () => {
    expect(() => parseFilter('from=last-tuesday')).toThrow(/YYYY-MM-DD/)
  })

  it('rejects a range bound that is not a number', () => {
    // Number('abc') is NaN, which would otherwise pass z.number() and become a
    // WHERE that silently matches nothing.
    expect(() => parseFilter('distance_min=abc')).toThrow()
  })

  it('rejects a bbox that is inside out, or off the globe', () => {
    expect(() => parseFilter('bbox=14,46,13,47')).toThrow(/min must not exceed max/)
    expect(() => parseFilter('bbox=13,46,14,999')).toThrow()
    expect(() => parseFilter('bbox=13,46,14')).toThrow()
  })

  it('rejects a sort key that is not a column', () => {
    expect(() => parseFilter('sort_key=title')).toThrow()
  })
})

describe('view state', () => {
  it('is parsed apart from the filter, since the server has no use for it', () => {
    expect(parseView('colour_by=trip&activity=123')).toEqual({ colourBy: 'trip', activity: 123 })
    expect(parseView('')).toEqual({ colourBy: null, activity: null })
  })

  it('joins the filter in one URL', () => {
    const filter = parseFilter('tag=sport:bike')
    expect(formatSearch(filter, { colourBy: 'sport', activity: 42 })).toBe(
      'tag=sport%3Abike&colour_by=sport&activity=42',
    )
  })

  it('rejects an activity id that is not one', () => {
    expect(() => parseView('activity=0')).toThrow()
    expect(() => parseView('activity=abc')).toThrow()
  })
})
