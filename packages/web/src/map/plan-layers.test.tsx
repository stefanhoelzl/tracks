import { featureFilter, latest, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { Leg, Waypoint } from '@tracks/routing'
import type {
  AddLayerObject,
  Map as MapLibreMap,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import {
  addPlanLayers,
  beelineFeatures,
  PLAN_FAILED_LAYER,
  PLAN_LINE_LAYER,
  PLAN_PENDING_LAYER,
  PLAN_POI_LAYER,
  PLAN_POINTS_SOURCE,
  PLAN_PREVIEW_SOURCE,
  PLAN_SHAPING_LAYER,
  PLAN_SOURCE,
  previewFeature,
  routeFeatures,
  showPlan,
  waypointFeatures,
} from './plan-layers.ts'

/** The same harness the track layers get, for the same reason — see `layers.test.tsx`. */
function collect() {
  const sources: Record<string, SourceSpecification> = {}
  const layers: AddLayerObject[] = []

  const map = {
    addSource: (id: string, source: SourceSpecification) => {
      sources[id] = source
    },
    addLayer: (layer: AddLayerObject) => {
      layers.push(layer)
    },
  } as unknown as MapLibreMap

  addPlanLayers(map)
  return { sources, layers }
}

const poi = (lon: number, lat: number, name: string | null = null): Waypoint => ({
  lon,
  lat,
  kind: 'poi',
  name,
})
const shaping = (lon: number, lat: number): Waypoint => ({ lon, lat, kind: 'routing', name: null })

const routed = (coordinates: Array<[number, number]>): Leg => ({
  ok: true,
  from: poi(0, 0),
  to: poi(1, 1),
  coordinates,
  altitudeM: coordinates.map(() => 500),
  distanceM: 100,
  ascentM: 10,
  descentM: 4,
  durationS: 60,
})

const failed = (): Leg => ({
  ok: false,
  from: poi(0, 0),
  to: poi(1, 1),
  coordinates: [
    [0, 0],
    [1, 1],
  ],
  reason: 'No route found',
})

describe('the plan layers', () => {
  it('builds a style MapLibre accepts', () => {
    const { sources, layers } = collect()
    const style = { version: 8, sources, layers } as unknown as StyleSpecification

    expect(validateStyleMin(style, latest)).toEqual([])
  })

  it('splits what is a route from what is only a straight line', () => {
    const { layers } = collect()
    // (expression, rootKey) — the second argument only names the location a failure
    // would be reported at.
    const filterOf = (id: string) =>
      featureFilter(
        (layers.find((layer) => layer.id === id) as { filter: unknown }).filter as never,
        `${id}.filter`,
      ).filter

    const context = { zoom: 12 } as never
    const routed = { type: 2, properties: { leg: 0, routed: true, pending: false } } as never
    const failed = { type: 2, properties: { leg: 1, routed: false, pending: false } } as never
    const waiting = { type: 2, properties: { leg: 2, routed: false, pending: true } } as never

    expect(filterOf(PLAN_LINE_LAYER)(context, routed, null as never)).toBe(true)
    expect(filterOf(PLAN_LINE_LAYER)(context, failed, null as never)).toBe(false)

    // A leg that cannot be routed and a leg that has not been routed yet are separate
    // layers, because only one of them may pulse: a failure that looks like it is
    // loading is a failure nobody stops waiting for.
    expect(filterOf(PLAN_FAILED_LAYER)(context, failed, null as never)).toBe(true)
    expect(filterOf(PLAN_FAILED_LAYER)(context, waiting, null as never)).toBe(false)
    expect(filterOf(PLAN_PENDING_LAYER)(context, waiting, null as never)).toBe(true)
    expect(filterOf(PLAN_PENDING_LAYER)(context, failed, null as never)).toBe(false)
    expect(filterOf(PLAN_PENDING_LAYER)(context, routed, null as never)).toBe(false)
  })

  it('draws POIs and shaping points from one source, split by kind', () => {
    const { layers } = collect()
    const layerOf = (id: string) =>
      layers.find((layer) => layer.id === id) as {
        source: string
        minzoom?: number
        filter: unknown
      }

    // One source, two layers: a shaping point is a property of the route rather than a
    // second kind of thing on the map.
    expect(layerOf(PLAN_POI_LAYER).source).toBe(PLAN_POINTS_SOURCE)
    expect(layerOf(PLAN_SHAPING_LAYER).source).toBe(PLAN_POINTS_SOURCE)
    // Subtle: it only appears once the map is at the scale where it is the handle you
    // reach for.
    expect(layerOf(PLAN_SHAPING_LAYER).minzoom).toBeGreaterThan(8)
    expect(layerOf(PLAN_POI_LAYER).minzoom).toBeUndefined()
  })

  it('gives every leg its own index, which is how a click knows what it hit', () => {
    const waypoints = [
      poi(11, 47, 'a'),
      poi(11.1, 47.1, 'b'),
      poi(11.2, 47.2, 'c'),
      poi(11.3, 47.3, 'd'),
    ]
    const features = routeFeatures(waypoints, [
      routed([
        [11, 47],
        [11.1, 47.1],
      ]),
      undefined,
      failed(),
    ]).features

    expect(features.map((feature) => feature.properties)).toEqual([
      { leg: 0, routed: true, pending: false },
      { leg: 1, routed: false, pending: true },
      { leg: 2, routed: false, pending: false },
    ])
  })

  it('draws a leg with no answer yet, so it is still there to be clicked', () => {
    // Without this a plan whose router is slow or unreachable has no line at all — and
    // no line means *insert here* and *shaping point* quietly stop being offered, for a
    // reason nobody could see.
    const waypoints = [poi(11, 47, 'a'), shaping(11.05, 47.05), poi(11.1, 47.1, 'b')]
    const [feature] = routeFeatures(waypoints, [undefined]).features

    expect(feature?.properties).toEqual({ leg: 0, routed: false, pending: true })
    // Straight through the hints it holds, which is where the route will run.
    expect(feature?.geometry.coordinates).toEqual([
      [11, 47],
      [11.05, 47.05],
      [11.1, 47.1],
    ])
  })

  it('previews a drag as straight lines between every consecutive waypoint', () => {
    const features = beelineFeatures([poi(11, 47), shaping(11.1, 47.1), poi(11.2, 47.2)]).features

    expect(features).toHaveLength(2)
    expect(features[0]?.geometry.coordinates).toEqual([
      [11, 47],
      [11.1, 47.1],
    ])
    // No leg index: a preview is not a leg, and dropping it is what makes one.
    expect(features[0]?.properties.leg).toBe(-1)
    expect(features[0]?.properties.routed).toBe(false)
  })

  it('carries each waypoint index, because every edit addresses one by it', () => {
    const features = waypointFeatures([poi(11, 47, 'Vent'), shaping(11.1, 47.1)]).features

    expect(features.map((feature) => feature.properties)).toEqual([
      { index: 0, poi: true, label: 'Vent' },
      { index: 1, poi: false, label: '' },
    ])
  })

  it('does nothing at all when its layers are gone', () => {
    // A style reload drops them, and the effect calling this cannot know that.
    const map = {
      getLayer: () => undefined,
      setLayoutProperty: () => {
        throw new Error('should not touch a layer that is not there')
      },
    } as unknown as MapLibreMap

    expect(() => showPlan(map, true)).not.toThrow()
  })

  it('names its sources so the plan and the tracks cannot collide', () => {
    const { sources } = collect()
    expect(Object.keys(sources).sort()).toEqual(
      [PLAN_POINTS_SOURCE, PLAN_PREVIEW_SOURCE, PLAN_SOURCE].sort(),
    )
  })

  it('rings a previewed place, and nothing at all without one', () => {
    // Not part of the plan, and drawn from its own source so it cannot be mistaken for
    // one — the question it answers is "which one is that?", not "what is in the plan".
    expect(previewFeature(null).features).toEqual([])
    expect(previewFeature({ lat: 47, lon: 11 }).features[0]?.geometry.coordinates).toEqual([11, 47])
  })
})
