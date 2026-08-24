import { describe, expect, it } from 'vitest'
import { simplify } from './polyline.ts'
import type { TrackPoint } from './source.ts'

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
