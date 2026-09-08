import { describe, expect, it } from 'vitest'
import {
  altitudesFromScalars,
  altitudesToScalars,
  decodeScalars,
  encodeScalars,
} from './track-codec.ts'

const roundTrip = (values: Array<number | null>) => decodeScalars(encodeScalars(values))

describe('encodeScalars / decodeScalars', () => {
  it('round-trips an ascending run', () => {
    const values = [0, 1, 2, 3, 100, 1000, 100_000]
    expect(roundTrip(values)).toEqual(values)
  })

  it('round-trips negatives and a descent', () => {
    const values = [-500, -100, 0, 100, -100, -100_000]
    expect(roundTrip(values)).toEqual(values)
  })

  it('round-trips nulls, wherever they fall', () => {
    const values = [null, 10, null, null, 20, null]
    expect(roundTrip(values)).toEqual(values)
  })

  it('keeps a gap from disturbing the values around it', () => {
    // The point after a dropout is a delta from the last *measured* value, not from the
    // gap, so a long absence costs one character each and no accumulated drift.
    expect(roundTrip([100, null, null, null, 101])).toEqual([100, null, null, null, 101])
  })

  it('handles the empty and all-null cases', () => {
    expect(encodeScalars([])).toBe('')
    expect(decodeScalars('')).toEqual([])
    expect(roundTrip([null, null])).toEqual([null, null])
  })

  it('spends one character per absent value', () => {
    expect(encodeScalars([null, null, null])).toHaveLength(3)
  })

  it('spends one character on a small delta', () => {
    // The doubling that makes room for the absent flag must not push a typical altitude
    // or time step into a second character - that is what keeps it to +1.5% overall.
    expect(encodeScalars([0, 3, 6])).toHaveLength(3)
  })

  it('rejects a stream that ends mid-value', () => {
    // Every chunk but the last sets the continuation bit; a stream ending on one is
    // truncated, and returning a short array would hide that behind a plausible answer.
    const truncated = encodeScalars([100_000]).slice(0, 1)
    expect(() => decodeScalars(truncated)).toThrow(/ends mid-value/)
  })

  it('rejects a character below the alphabet', () => {
    expect(() => decodeScalars('\u0001')).toThrow(/outside the alphabet/)
  })
})

describe('altitude scaling', () => {
  it('round-trips a tenth of a metre, preserving nulls', () => {
    const metres = [117.4, 117.8, null, 118.2]
    expect(altitudesFromScalars(altitudesToScalars(metres))).toEqual(metres)
  })

  it('rounds to the nearest decimetre', () => {
    expect(altitudesToScalars([117.44, 117.46])).toEqual([1174, 1175])
  })
})
