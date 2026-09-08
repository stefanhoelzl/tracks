import type { Waypoint } from '@tracks/routing'
import { describe, expect, it } from 'vitest'
import { emptyPlan, formatPlan, type Plan, parsePlan } from './plan.ts'

const poi = (lat: number, lon: number, name: string | null = null): Waypoint => ({
  lat,
  lon,
  kind: 'poi',
  name,
})
const shaping = (lat: number, lon: number): Waypoint => ({ lat, lon, kind: 'routing', name: null })

const plan = (waypoints: Waypoint[], rest: Partial<Plan> = {}): Plan => ({
  ...emptyPlan(),
  waypoints,
  ...rest,
})

/** Coordinates survive the codec at its precision, which is about a metre. */
const roughly = (waypoints: readonly Waypoint[]) =>
  waypoints.map((w) => [Number(w.lat.toFixed(5)), Number(w.lon.toFixed(5)), w.kind, w.name])

describe('the plan fragment', () => {
  it('round-trips waypoints, their kinds and the names of the POIs', () => {
    const original = plan(
      [poi(47.2654, 11.3931, 'Start'), shaping(47.2678, 11.3952), poi(47.2668, 11.3975, 'Gasthof')],
      { name: 'Ötztal loop', profile: 'gravel' },
    )

    const back = parsePlan(formatPlan(original))

    expect(back.name).toBe('Ötztal loop')
    expect(back.profile).toBe('gravel')
    expect(roughly(back.waypoints)).toEqual(roughly(original.waypoints))
  })

  it('writes no default: an empty plan is no fragment at all', () => {
    expect(formatPlan(emptyPlan())).toBe('')
    // Trekking is the default, so only the other four are ever written down.
    expect(formatPlan(plan([poi(47, 11), poi(48, 12)]))).not.toContain('profile=')
    expect(formatPlan(plan([poi(47, 11), poi(48, 12)], { profile: 'mtb' }))).toContain(
      'profile=mtb',
    )
  })

  it('keeps an unnamed POI in its slot rather than shifting the names after it', () => {
    const original = plan([poi(47.0, 11.0, 'A'), poi(47.1, 11.1), poi(47.2, 11.2, 'C')])

    const names = parsePlan(formatPlan(original)).waypoints.map((w) => w.name)
    expect(names).toEqual(['A', null, 'C'])
  })

  it('survives the characters the codec emits that a fragment may not carry raw', () => {
    // Polyline encoding emits ASCII 63-126, and that range includes a backslash. The
    // fragment is a URLSearchParams precisely so escaping is not this module's problem.
    const original = plan([poi(47.20661, 11.83194), poi(46.83411, 10.99413)])

    const fragment = formatPlan(original)
    expect(fragment).not.toMatch(/[\\ ]/)
    expect(roughly(parsePlan(fragment).waypoints)).toEqual(roughly(original.waypoints))
  })

  it('reads a fragment with or without its hash', () => {
    const fragment = formatPlan(plan([poi(47, 11, 'A'), poi(48, 12, 'B')]))

    expect(parsePlan(`#${fragment}`).waypoints).toHaveLength(2)
    expect(parsePlan(fragment).waypoints).toHaveLength(2)
  })

  it('is an empty plan when there is no fragment', () => {
    expect(parsePlan('')).toEqual(emptyPlan())
    expect(parsePlan('#')).toEqual(emptyPlan())
  })

  it('refuses a fragment whose parts disagree rather than dropping waypoints', () => {
    const fragment = formatPlan(plan([poi(47, 11, 'A'), shaping(48, 12), poi(49, 13, 'B')]))

    // Losing half a plan without being told would be the worse failure by a distance,
    // and `useUrlState` already has a banner for a URL the grammar rejects.
    expect(() => parsePlan(fragment.replace('kinds=prp', 'kinds=pp'))).toThrow(/3 waypoints/)
  })

  it('falls back to the default profile rather than trusting a hand-edited one', () => {
    const fragment = formatPlan(plan([poi(47, 11), poi(48, 12)], { profile: 'mtb' }))

    expect(parsePlan(fragment.replace('profile=mtb', 'profile=helicopter')).profile).toBe(
      'trekking',
    )
  })
})
