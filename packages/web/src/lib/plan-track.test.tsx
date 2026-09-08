import type { Leg, Waypoint } from '@tracks/routing'
import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan } from './plan.ts'
import { moveStop } from './plan-ops.ts'
import { cumulative, planTotals, planTrack } from './plan-track.ts'

const poi = (lon: number, name: string | null = null): Waypoint => ({
  lon,
  lat: 0,
  kind: 'poi',
  name,
})
const shaping = (lon: number): Waypoint => ({ lon, lat: 0, kind: 'routing', name: null })

const routed = (coordinates: Array<[number, number]>, metrics: Partial<Leg & { ok: true }> = {}) =>
  ({
    ok: true,
    from: poi(0),
    to: poi(1),
    coordinates,
    altitudeM: coordinates.map((_, index) => 500 + index),
    distanceM: 1000,
    ascentM: 100,
    descentM: 40,
    durationS: 600,
    ...metrics,
  }) satisfies Leg

const failed = (): Leg => ({
  ok: false,
  from: poi(0),
  to: poi(1),
  coordinates: [
    [0, 0],
    [1, 0],
  ],
  reason: 'No route found',
})

describe('planTotals', () => {
  it('sums what routed and says so when something did not', () => {
    expect(planTotals([routed([[0, 0]]), routed([[1, 0]])])).toEqual({
      distanceM: 2000,
      ascentM: 200,
      descentM: 80,
      durationS: 1200,
      incomplete: false,
    })

    // Excluded and declared, rather than beelined into the total with nothing saying so.
    expect(planTotals([routed([[0, 0]]), failed()])).toMatchObject({
      distanceM: 1000,
      incomplete: true,
    })
    // A leg still in flight is as incomplete as one that failed.
    expect(planTotals([routed([[0, 0]]), undefined]).incomplete).toBe(true)
  })
})

describe('planTrack', () => {
  it('joins legs at the POI they share, without repeating the point', () => {
    const track = planTrack([
      routed([
        [0, 0],
        [1, 0],
      ]),
      routed([
        [1, 0],
        [2, 0],
      ]),
    ])

    expect(track.coordinates).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ])
    expect(track.altitudeM).toHaveLength(3)
  })

  it('keeps an unroutable leg as a gap rather than as a flat line', () => {
    const track = planTrack([
      routed([
        [0, 0],
        [1, 0],
      ]),
      failed(),
    ])

    // The shape of the plan survives; the claim about what is under it does not — and
    // nulls are exactly how the profile already draws missing altitude.
    expect(track.coordinates).toHaveLength(3)
    expect(track.altitudeM.slice(-1)).toEqual([null])
  })
})

describe('cumulative', () => {
  it('adds up leg by leg, and stays incomplete once a leg is missing', () => {
    const running = cumulative([routed([[0, 0]]), failed(), routed([[2, 0]])])

    expect(running.map((total) => total.distanceM)).toEqual([1000, 1000, 2000])
    // Sticky: every total after the gap is short by that leg, so a row reading 2 km
    // three legs later would be quietly wrong.
    expect(running.map((total) => total.incomplete)).toEqual([false, true, true])
  })
})

const planOf = (waypoints: Waypoint[]): Plan => ({ ...emptyPlan(), waypoints })
const shape = (plan: Plan) => plan.waypoints.map((w) => (w.kind === 'poi' ? w.name : `~${w.lon}`))

describe('moveStop', () => {
  it('moves a stop together with the hints that lead out of it', () => {
    const plan = planOf([poi(0, 'A'), shaping(1), poi(2, 'B'), shaping(3), poi(4, 'C')])

    // The ticks between two rows belong to the leg leaving the row above them, so a
    // stop drags with the way out of it.
    expect(shape(moveStop(plan, 2, 0))).toEqual(['C', 'A', '~1', 'B', '~3'])
    expect(shape(moveStop(plan, 0, 2))).toEqual(['B', '~3', 'C', 'A', '~1'])
  })

  it('leaves the plan alone for a move that goes nowhere', () => {
    const plan = planOf([poi(0, 'A'), poi(2, 'B')])

    expect(moveStop(plan, 1, 1)).toBe(plan)
    expect(moveStop(plan, 0, 5)).toBe(plan)
    expect(moveStop(plan, 4, 0)).toBe(plan)
  })

  it('leaves hints that precede the first stop where they are', () => {
    const plan = planOf([shaping(-1), poi(0, 'A'), poi(2, 'B')])

    // They belong to no stop, and the router drops them anyway.
    expect(shape(moveStop(plan, 1, 0))).toEqual(['~-1', 'B', 'A'])
  })
})
