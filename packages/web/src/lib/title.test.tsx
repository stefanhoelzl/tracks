import type { ActivityRow } from '@tracks/core'
import type { Waypoint } from '@tracks/routing'
import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan } from './plan.ts'
import { type TitleState, titleOf } from './title.ts'

const poi = (lon: number, name: string | null = null): Waypoint => ({
  lon,
  lat: 0,
  kind: 'poi',
  name,
})
const shaping = (lon: number): Waypoint => ({ lon, lat: 0, kind: 'routing', name: null })

const planOf = (waypoints: Waypoint[], name = ''): Plan => ({ ...emptyPlan(), name, waypoints })

const row = (title: string | null): ActivityRow => ({
  id: 7,
  source: 'komoot',
  title,
  startedAt: '2025-08-23T05:00:00.000Z',
  utcOffset: 7200,
  localDate: '2025-08-23',
  distanceM: 24_300,
  durationS: 28_800,
  elapsedS: 30_000,
  elevationGainM: 1900,
  speedMs: 0.84,
  tags: [],
})

/** The default is the quiet case: activities, nothing selected, no plan. */
const title = (state: Partial<TitleState> = {}): string =>
  titleOf({ mode: 'activities', plan: emptyPlan(), activity: null, pending: false, ...state })

describe('what the tab says', () => {
  it('says nothing specific when nothing specific is on screen', () => {
    expect(title()).toBe('')
  })

  it('names the open activity, and says Untitled where the panel does', () => {
    expect(title({ activity: row('Orla Perc') })).toBe('Orla Perc')
    expect(title({ activity: row(null) })).toBe('Untitled')
  })

  it('says so while the name is still coming', () => {
    expect(title({ pending: true })).toBe('Loading…')
  })

  it('falls back to the brand alone when the fetch failed', () => {
    // Neither data nor pending: the panel is carrying the error, and the tab has
    // nothing specific left to say.
    expect(title({ activity: null, pending: false })).toBe('')
  })
})

describe('the ladder', () => {
  it('puts analytics ahead of a selected activity, which survives the mode switch', () => {
    expect(title({ mode: 'analytics', activity: row('Orla Perc') })).toBe('Analytics')
    expect(title({ mode: 'analytics', pending: true })).toBe('Analytics')
  })

  it('puts planning ahead of everything, since the detail panel is not even on screen', () => {
    expect(title({ mode: 'planning', activity: row('Orla Perc') })).toBe('Planning')
  })
})

describe('a plan', () => {
  it('keeps Planning in front of the name, so it cannot read as an activity', () => {
    expect(title({ mode: 'planning', plan: planOf([], 'Alpine loop') })).toBe(
      'Alpine loop · Planning',
    )
  })

  it('falls back to the two ends when nobody has named it', () => {
    const plan = planOf([poi(0, 'Herzogstand'), shaping(1), poi(2, 'Walchensee')])
    expect(title({ mode: 'planning', plan })).toBe('Herzogstand → Walchensee · Planning')
  })

  it('names the ends it has, and says Planning until there are two', () => {
    expect(title({ mode: 'planning', plan: planOf([poi(0, 'Herzogstand')]) })).toBe('Planning')
    // Shaping points do not bound anything, so two of them are still no plan to name.
    expect(title({ mode: 'planning', plan: planOf([shaping(0), shaping(1)]) })).toBe('Planning')
    expect(title({ mode: 'planning', plan: planOf([poi(0), poi(2)]) })).toBe(
      'Start → End · Planning',
    )
  })

  it('prefers the name that was typed over the one derived from the ends', () => {
    const plan = planOf([poi(0, 'Herzogstand'), poi(2, 'Walchensee')], 'Alpine loop')
    expect(title({ mode: 'planning', plan })).toBe('Alpine loop · Planning')
  })
})
