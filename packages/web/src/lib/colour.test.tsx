import { describe, expect, it } from 'vitest'
import {
  activityColour,
  buildScale,
  colourForSlot,
  HASHED,
  NEUTRAL_SLOT,
  neutralColour,
  PALETTE_SIZE,
  preferredSlot,
} from './colour.ts'

const SPORTS = ['bike', 'hike', 'run']

describe('the colour scale', () => {
  it('gives the seeded sports three different colours', () => {
    // The bug this whole mechanism exists for: a plain hash put `sport:bike` and
    // `sport:hike` on the same green, and the map could not tell a ride from a walk.
    const scale = buildScale([{ type: 'sport', values: SPORTS }])
    const colours = SPORTS.map((value) => scale.colour('sport', value))

    expect(new Set(colours).size).toBe(SPORTS.length)
  })

  it('gives every value of a type its own colour, up to the palette size', () => {
    const values = Array.from({ length: PALETTE_SIZE }, (_, i) => `value-${i}`)
    const scale = buildScale([{ type: 'trip', values }])

    const slots = values.map((v) => scale.slot('trip', v))
    expect(new Set(slots).size).toBe(PALETTE_SIZE)
  })

  it('keeps a value on its preferred slot when nothing contends for it', () => {
    const scale = buildScale([{ type: 'trip', values: ['Balkan 2026'] }])
    expect(scale.slot('trip', 'Balkan 2026')).toBe(preferredSlot('trip:Balkan 2026'))
  })

  it('depends on the value set, not the order it arrived in', () => {
    const forwards = buildScale([{ type: 'sport', values: SPORTS }])
    const backwards = buildScale([{ type: 'sport', values: [...SPORTS].reverse() }])

    for (const value of SPORTS) {
      expect(backwards.slot('sport', value)).toBe(forwards.slot('sport', value))
    }
  })

  it('lays out each type independently, so one type cannot push another', () => {
    const together = buildScale([
      { type: 'sport', values: SPORTS },
      { type: 'source', values: ['strava', 'komoot'] },
    ])
    const alone = buildScale([{ type: 'sport', values: SPORTS }])

    for (const value of SPORTS) {
      expect(together.slot('sport', value)).toBe(alone.slot('sport', value))
    }
  })

  it('wraps rather than breaking when a type outgrows the palette', () => {
    const values = Array.from({ length: PALETTE_SIZE + 3 }, (_, i) => `t${i}`)
    const scale = buildScale([{ type: 'trip', values }])

    for (const value of values) {
      const slot = scale.slot('trip', value)
      expect(slot).toBeGreaterThanOrEqual(0)
      expect(slot).toBeLessThan(PALETTE_SIZE)
    }
    // Ten slots cannot hold thirteen values, and say so by repeating.
    expect(new Set(values.map((v) => scale.slot('trip', v))).size).toBe(PALETTE_SIZE)
  })

  it('falls back to the plain hash for a value it was never told about', () => {
    const scale = buildScale([{ type: 'sport', values: SPORTS }])
    expect(scale.slot('trip', 'Unheard Of')).toBe(preferredSlot('trip:Unheard Of'))
    expect(HASHED.slot('trip', 'Unheard Of')).toBe(preferredSlot('trip:Unheard Of'))
  })

  it('never assigns the neutral, which belongs to absence alone', () => {
    const values = Array.from({ length: PALETTE_SIZE + 5 }, (_, i) => `t${i}`)
    const scale = buildScale([{ type: 'trip', values }])

    for (const value of values) {
      expect(scale.colour('trip', value)).not.toBe(neutralColour())
      expect(scale.slot('trip', value)).not.toBe(NEUTRAL_SLOT)
    }
  })

  it('reads a whole tag string, splitting on the first colon', () => {
    const scale = buildScale([{ type: 'trip', values: ['Balkan: 2026'] }])
    expect(scale.colourForTag('trip:Balkan: 2026')).toBe(scale.colour('trip', 'Balkan: 2026'))
  })
})

describe('colouring an activity', () => {
  const scale = buildScale([
    { type: 'sport', values: SPORTS },
    { type: 'year', values: ['2024', '2025'] },
  ])

  it('uses the value of the selected type', () => {
    expect(activityColour(['source:komoot', 'sport:hike'], 2025, 'sport', scale)).toBe(
      scale.colour('sport', 'hike'),
    )
  })

  it('is neutral when the activity has no value of that type', () => {
    expect(activityColour(['source:strava'], 2025, 'sport', scale)).toBe(neutralColour())
  })

  it('colours by year without any tag being involved', () => {
    expect(activityColour(['source:strava'], 2024, 'year', scale)).toBe(
      scale.colour('year', '2024'),
    )
    expect(activityColour([], 2024, 'year', scale)).not.toBe(
      activityColour([], 2025, 'year', scale),
    )
  })

  it('takes the lowest-sorted value when a type is multi-valued', () => {
    // Stored arrays are sorted, so the first match is the lowest — stated here so
    // the legend and the map agree about which one won.
    expect(activityColour(['sport:bike', 'sport:run'], 2025, 'sport', scale)).toBe(
      scale.colour('sport', 'bike'),
    )
  })

  it('maps every slot to a real colour', () => {
    for (let slot = 0; slot <= NEUTRAL_SLOT; slot++) {
      expect(colourForSlot(slot)).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})
