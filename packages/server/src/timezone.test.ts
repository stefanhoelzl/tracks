import { describe, expect, it } from 'vitest'
import { offsetSeconds, utcOffsetAt } from './timezone.ts'

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
