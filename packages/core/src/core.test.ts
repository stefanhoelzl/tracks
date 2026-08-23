import { describe, expect, it } from 'vitest'
import { simplify } from './polyline.ts'
import type { TrackPoint } from './source.ts'
import { isReservedTag, toSport } from './sport.ts'
import { offsetSeconds, utcOffsetAt } from './timezone.ts'

describe('sport mapping', () => {
  it('maps locale-independent file vocabularies', () => {
    expect(toSport('running')).toBe('run') // GPX <type>
    expect(toSport('Run')).toBe('run') // TCX Sport
    expect(toSport('hiking')).toBe('hike')
    expect(toSport('Mountain Biking')).toBe('mtb')
  })

  it('distinguishes "said nothing" from "said something unrecognised"', () => {
    // Null means leave existing tags alone; 'other' means actively tag as other.
    expect(toSport(null)).toBeNull()
    expect(toSport('')).toBeNull()
    expect(toSport('curling')).toBe('other')
  })

  it('reserves canonical names from manual tagging', () => {
    expect(isReservedTag('ride')).toBe(true)
    expect(isReservedTag('Ride')).toBe(true)
    expect(isReservedTag('alps-2024')).toBe(false)
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
