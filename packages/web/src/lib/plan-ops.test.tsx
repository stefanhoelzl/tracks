import type { Leg, Waypoint } from '@tracks/routing'
import { describe, expect, it } from 'vitest'
import { emptyPlan, type Plan } from './plan.ts'
import {
  addWaypoint,
  insertionAt,
  kindIsAChoice,
  legCount,
  moveWaypoint,
  placementAt,
  removeWaypoint,
  setKind,
} from './plan-ops.ts'

const poi = (lon: number, lat: number, name: string | null = null): Waypoint => ({
  lon,
  lat,
  kind: 'poi',
  name,
})
const shaping = (lon: number, lat: number): Waypoint => ({ lon, lat, kind: 'routing', name: null })

const planOf = (waypoints: Waypoint[]): Plan => ({ ...emptyPlan(), waypoints })

/** A leg drawn straight along the equator from x=0 to x=10, so "along" is just x. */
const straight = (fromX: number, toX: number): Leg => {
  const coordinates: Array<[number, number]> = []
  for (let x = fromX; x <= toX; x += 0.5) coordinates.push([x, 0])
  return {
    ok: true,
    from: poi(fromX, 0),
    to: poi(toX, 0),
    coordinates,
    altitudeM: coordinates.map(() => 100),
    distanceM: 1000,
    ascentM: 0,
    descentM: 0,
    durationS: 300,
  }
}

const kinds = (plan: Plan) => plan.waypoints.map((w) => `${w.kind}@${w.lon}`)

describe('legs and POIs', () => {
  it('counts legs between POIs, never between shaping points', () => {
    expect(legCount(planOf([]))).toBe(0)
    expect(legCount(planOf([poi(0, 0)]))).toBe(0)
    expect(legCount(planOf([poi(0, 0), shaping(1, 0), poi(2, 0)]))).toBe(1)
    expect(legCount(planOf([poi(0, 0), poi(1, 0), poi(2, 0)]))).toBe(2)
  })

  it('makes the kind a choice only once there is a line to shape', () => {
    // The first two clicks are the start and the end, with no toggle at all.
    expect(kindIsAChoice(planOf([]))).toBe(false)
    expect(kindIsAChoice(planOf([poi(0, 0)]))).toBe(false)
    expect(kindIsAChoice(planOf([poi(0, 0), poi(1, 0)]))).toBe(true)
  })
})

describe('inserting into a leg', () => {
  it('orders shaping points by how far along the leg they sit', () => {
    const plan = planOf([poi(0, 0), shaping(2, 0), shaping(8, 0), poi(10, 0)])
    const legs = [straight(0, 10)]

    // Dropped near the start of the leg, it goes before both existing hints — not
    // after them, which would send the route back through the ones near the end.
    expect(insertionAt(plan, legs, 0, { lat: 0, lon: 1 })).toBe(1)
    expect(insertionAt(plan, legs, 0, { lat: 0, lon: 5 })).toBe(2)
    expect(insertionAt(plan, legs, 0, { lat: 0, lon: 9 })).toBe(3)
  })

  it('lands inside the leg it was told about, not the whole plan', () => {
    const plan = planOf([poi(0, 0), poi(10, 0), shaping(12, 0), poi(20, 0)])
    const legs = [straight(0, 10), straight(10, 20)]

    expect(insertionAt(plan, legs, 0, { lat: 0, lon: 5 })).toBe(1)
    expect(insertionAt(plan, legs, 1, { lat: 0, lon: 18 })).toBe(3)
  })

  it('falls to the end of the leg when there is no geometry to measure against', () => {
    // Only reachable before the first response lands.
    const plan = planOf([poi(0, 0), shaping(2, 0), poi(10, 0)])
    expect(insertionAt(plan, [undefined], 0, { lat: 0, lon: 1 })).toBe(2)
  })
})

describe('placement', () => {
  const plan = planOf([poi(0, 0), poi(10, 0)])
  const legs = [straight(0, 10)]

  it('puts a start first and an end last', () => {
    expect(placementAt(plan, legs, 'start', null, { lat: 0, lon: -5 })).toBe(0)
    expect(placementAt(plan, legs, 'end', null, { lat: 0, lon: 15 })).toBe(2)
  })

  it('appends when nearest was asked for but nothing was under the pointer', () => {
    expect(placementAt(plan, legs, 'nearest', null, { lat: 0, lon: 5 })).toBe(2)
  })

  it('splits the leg it landed on', () => {
    expect(placementAt(plan, legs, 'nearest', 0, { lat: 0, lon: 5 })).toBe(1)
  })
})

describe('editing a waypoint', () => {
  it('adds, removes and moves by index', () => {
    const plan = planOf([poi(0, 0), poi(10, 0)])

    expect(kinds(addWaypoint(plan, shaping(5, 0), 1))).toEqual(['poi@0', 'routing@5', 'poi@10'])
    expect(kinds(removeWaypoint(plan, 0))).toEqual(['poi@10'])
    expect(moveWaypoint(plan, 1, { lat: 3, lon: 4 }).waypoints[1]).toMatchObject({ lat: 3, lon: 4 })
  })

  it('drops the name when a stop becomes a shaping point', () => {
    const plan = planOf([poi(0, 0, 'A'), poi(5, 0, 'Gasthof'), poi(10, 0, 'B')])

    // A bare point is exactly what the wire format wants for a shaping point, and a
    // hint has nothing to be called.
    expect(setKind(plan, 1, 'routing').waypoints[1]).toMatchObject({ kind: 'routing', name: null })
  })

  it('refuses a kind change that would leave the plan without two ends', () => {
    const plan = planOf([poi(0, 0, 'A'), poi(10, 0, 'B')])

    // Demoting one of two POIs leaves nothing to route between, and the toggle is not
    // offered there — this is what keeps that true rather than trusting every caller.
    expect(setKind(plan, 1, 'routing')).toBe(plan)
  })
})
