import { describe, expect, it } from 'vitest'
import { buildBandOption } from './Distributions.tsx'

/**
 * The distribution card's whole job beyond `bands()`: naming the bands in the units
 * they are read in, and putting the count where a draggable histogram cannot.
 */

type Built = {
  xAxis: { data: string[] }
  series: Array<{ data: number[]; label: { formatter: (p: { value: unknown }) => string } }>
}

const data = {
  edges: [
    { min: 0, max: 5_000 },
    { min: 5_000, max: 15_000 },
    { min: 15_000, max: null },
  ],
  counts: [7, 0, 26],
  missing: 1,
}

describe('the distribution option', () => {
  it('names bands in display units, with the last one open-ended', () => {
    expect((buildBandOption(data, 'distance') as unknown as Built).xAxis.data).toEqual([
      '0–5',
      '5–15',
      '15+',
    ])
  })

  it('converts each metric into the words it is said in', () => {
    // SI in — seconds, metres per second — and hours and km/h out, the same division
    // `format.ts` already draws for every other readout.
    const hours = {
      ...data,
      edges: [
        { min: 0, max: 3_600 },
        { min: 3_600, max: 14_400 },
        { min: 14_400, max: null },
      ],
    }
    expect((buildBandOption(hours, 'duration') as unknown as Built).xAxis.data).toEqual([
      '0–1',
      '1–4',
      '4+',
    ])

    const speeds = {
      ...data,
      edges: [
        { min: 0, max: 2.8 },
        { min: 2.8, max: 5.6 },
        { min: 5.6, max: null },
      ],
    }
    expect((buildBandOption(speeds, 'speed') as unknown as Built).xAxis.data).toEqual([
      '0–10',
      '10–20',
      '20+',
    ])
  })

  it('puts the count on the bar, and says nothing on an empty band', () => {
    const option = buildBandOption(data, 'distance') as unknown as Built
    const { formatter } = option.series[0]!.label

    expect(option.series[0]!.data).toEqual([7, 0, 26])
    expect(formatter({ value: 26 })).toBe('26')
    // A band nothing landed in is not a place to write a zero.
    expect(formatter({ value: 0 })).toBe('')
  })
})
