import { describe, expect, it } from 'vitest'
import { simplify } from './polyline.ts'
import type { TrackPoint } from './source.ts'
import {
  formatTagTerm,
  mergeDerivedTags,
  parseTag,
  parseTagTerm,
  sortTags,
  type TagRegistry,
  validateTag,
} from './tags.ts'
import { offsetSeconds, utcOffsetAt } from './timezone.ts'

const registry: TagRegistry = new Map([
  [
    'sport',
    {
      name: 'sport',
      label: 'Sport',
      enumValues: ['bike', 'hike', 'run'],
      singleValued: true,
      color: '#0A6B48',
      sort: 1,
    },
  ],
  [
    'trip',
    {
      name: 'trip',
      label: 'Trip',
      enumValues: null,
      singleValued: true,
      color: '#CE7A0C',
      sort: 2,
    },
  ],
])

describe('tag grammar', () => {
  it('splits on the first colon, keeping the value verbatim', () => {
    // A trip name is what you typed, so nothing has to un-mangle it for display.
    expect(parseTag('trip:Balkan 2026')).toEqual({ type: 'trip', value: 'Balkan 2026' })
    expect(parseTag('trip:a:b')).toEqual({ type: 'trip', value: 'a:b' })
  })

  it('rejects anything that is not <type>:<value>', () => {
    expect(parseTag('alps')).toBeNull() // bare tags do not exist
    expect(parseTag(':alps')).toBeNull()
    expect(parseTag('sport:')).toBeNull() // an empty value only means absence
    expect(parseTag('Sport:bike')).toBeNull() // types are identifiers
  })

  it('validates against the registry, not against a word list', () => {
    expect(validateTag(registry, 'sport:hike')).toBeNull()
    expect(validateTag(registry, 'trip:Balkan 2026')).toBeNull() // free string
    expect(validateTag(registry, 'sport:ski')).toMatch(/not a value/)
    expect(validateTag(registry, 'gear:steel')).toMatch(/no tag type/)
  })

  it('sorts and deduplicates on write', () => {
    expect(sortTags(['trip:Alps', 'sport:hike', 'sport:hike'])).toEqual(['sport:hike', 'trip:Alps'])
  })
})

describe('merging derived tags', () => {
  it('replaces within a type the source spoke about', () => {
    expect(mergeDerivedTags(['sport:run', 'trip:Alps'], ['sport:bike'])).toEqual([
      'sport:bike',
      'trip:Alps',
    ])
  })

  it('leaves a type the source said nothing about alone', () => {
    // The untyped Garmin rides are tagged by hand; a re-import must not undo that.
    expect(mergeDerivedTags(['sport:bike', 'trip:Alps'], [])).toEqual(['sport:bike', 'trip:Alps'])
  })

  it('never touches a type the importer does not own', () => {
    expect(mergeDerivedTags(['trip:Alps'], ['source:strava'])).toEqual([
      'source:strava',
      'trip:Alps',
    ])
  })
})

describe('tag filter terms', () => {
  it('reads inclusion, exclusion and absence', () => {
    expect(parseTagTerm('sport:bike')).toEqual({ type: 'sport', value: 'bike', negated: false })
    expect(parseTagTerm('-sport:run')).toEqual({ type: 'sport', value: 'run', negated: true })
    // An empty value can only mean absence, since the grammar forbids one elsewhere.
    expect(parseTagTerm('trip:')).toEqual({ type: 'trip', value: null, negated: false })
    expect(parseTagTerm('-sport:')).toEqual({ type: 'sport', value: null, negated: true })
  })

  it('round-trips', () => {
    for (const raw of ['sport:bike', '-sport:run', 'trip:', '-trip:Balkan 2026']) {
      expect(formatTagTerm(parseTagTerm(raw)!)).toBe(raw)
    }
  })
})

describe('timezone derivation', () => {
  // Nothing in a Strava archive records an offset, so it comes from coordinates.
  const munich = { lat: 48.1374, lon: 11.5755 }

  it('handles DST at the same location', () => {
    expect(utcOffsetAt(munich.lat, munich.lon, new Date('2024-10-16T15:57:17Z'))).toBe(7200)
    expect(utcOffsetAt(munich.lat, munich.lon, new Date('2024-01-16T15:57:17Z'))).toBe(3600)
  })

  it('handles zones east, west and at UTC', () => {
    expect(offsetSeconds('Europe/London', new Date('2024-01-15T12:00:00Z'))).toBe(0)
    expect(offsetSeconds('America/Los_Angeles', new Date('2024-01-15T12:00:00Z'))).toBe(-28800)
    expect(offsetSeconds('Asia/Kolkata', new Date('2024-01-15T12:00:00Z'))).toBe(19800)
  })

  it('puts an evening activity on the right local day', () => {
    // 2020-10-28T19:57:46Z in Munich is 20:57 local — still the 28th.
    const started = new Date('2020-10-28T19:57:46Z')
    const offset = utcOffsetAt(munich.lat, munich.lon, started)
    const local = new Date(started.getTime() + offset * 1000)
    expect(local.toISOString().slice(0, 10)).toBe('2020-10-28')
  })
})

describe('simplify', () => {
  const point = (lat: number, lon: number): TrackPoint => ({
    lat,
    lon,
    altitudeM: null,
    recordedAt: null,
  })

  it('keeps both endpoints and drops collinear middles', () => {
    const straight = Array.from({ length: 50 }, (_, i) => point(48.0 + i * 0.0001, 11.0))
    const result = simplify(straight)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(straight[0])
    expect(result.at(-1)).toEqual(straight.at(-1))
  })

  it('keeps a corner that exceeds the tolerance', () => {
    // ~110 m detour, far beyond the 10 m default.
    const corner = [point(48.0, 11.0), point(48.001, 11.0), point(48.0, 11.002)]
    expect(simplify(corner)).toHaveLength(3)
  })

  it('handles short tracks without touching them', () => {
    expect(simplify([])).toHaveLength(0)
    expect(simplify([point(48, 11)])).toHaveLength(1)
  })

  it('does not blow the stack on a long track', () => {
    const long = Array.from({ length: 25_000 }, (_, i) =>
      point(48 + Math.sin(i / 40) * 0.02, 11 + i * 0.00001),
    )
    expect(() => simplify(long)).not.toThrow()
    expect(simplify(long).length).toBeLessThan(long.length)
  })
})
