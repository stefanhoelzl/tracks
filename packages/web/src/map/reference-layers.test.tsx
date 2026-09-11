import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type {
  AddLayerObject,
  Map as MapLibreMap,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import type { Reference } from '../lib/references.ts'
import {
  addReferenceLayers,
  REFERENCE_LINE_LAYER,
  REFERENCE_VERTEX_LAYER,
  REFERENCE_WPT_LAYER,
  referenceFeatures,
  referencePointFeatures,
} from './reference-layers.ts'

/** The same harness the plan layers get, for the same reason — see `layers.test.tsx`. */
function collect() {
  const sources: Record<string, SourceSpecification> = {}
  const layers: Array<{ layer: AddLayerObject; before: string | undefined }> = []

  const map = {
    addSource: (id: string, source: SourceSpecification) => {
      sources[id] = source
    },
    addLayer: (layer: AddLayerObject, before?: string) => {
      layers.push({ layer, before })
    },
    // The plan is added before any file is dropped, so its casing is always there.
    getLayer: (id: string) => (id === 'plan-casing' ? {} : undefined),
  } as unknown as MapLibreMap

  addReferenceLayers(map)
  return { sources, layers }
}

const reference = (over: Partial<Reference> = {}): Reference => ({
  id: 'a',
  name: 'Day 3',
  kind: 'track',
  slot: 1,
  colour: '#ce7a0c',
  points: [
    { lat: 47.0, lon: 11.0, altitudeM: 600 },
    { lat: 47.1, lon: 11.1, altitudeM: 900 },
  ],
  distanceM: 12_400,
  waypoints: [],
  ...over,
})

describe('the reference layers', () => {
  it('builds a style MapLibre accepts', () => {
    const { sources, layers } = collect()
    const style = {
      version: 8,
      sources,
      layers: layers.map((entry) => entry.layer),
    } as unknown as StyleSpecification

    expect(validateStyleMin(style)).toEqual([])
  })

  it('puts every layer under the plan, so a file never draws over your route', () => {
    const { layers } = collect()

    expect(layers.every((entry) => entry.before === 'plan-casing')).toBe(true)
  })

  it('paints each line in its own colour rather than one shared hue', () => {
    const { layers } = collect()
    const line = layers.find((entry) => entry.layer.id === REFERENCE_LINE_LAYER)?.layer as {
      paint: Record<string, unknown>
    }

    expect(line.paint['line-color']).toEqual(['get', 'colour'])
  })
})

describe('what gets drawn', () => {
  it('draws one line per part, and skips a part with nothing to join', () => {
    const features = referenceFeatures([
      reference(),
      reference({ id: 'b', points: [{ lat: 47, lon: 11, altitudeM: null }] }),
    ])

    expect(features.features).toHaveLength(1)
    expect(features.features[0]?.properties?.colour).toBe('#ce7a0c')
  })

  it("marks a route's own points, and a track's not at all", () => {
    const asRoute = referencePointFeatures([reference({ kind: 'route' })])
    const asTrack = referencePointFeatures([reference({ kind: 'track' })])

    // A route is turn instructions, so its line cuts corners; showing its points is
    // what makes that read as sparse rather than as wrong.
    expect(asRoute.features).toHaveLength(2)
    expect(asTrack.features).toHaveLength(0)
  })

  it('carries a waypoint at its own coordinates, with the name for the dialog', () => {
    const features = referencePointFeatures([
      reference({ waypoints: [{ lat: 46.9012, lon: 10.8701, name: 'Sesvennahütte' }] }),
    ])
    const mark = features.features[0]?.properties

    // Read back by the click handler, so adopting a hut puts the stop where the file
    // put it rather than where the pointer landed.
    expect(mark?.lat).toBe(46.9012)
    expect(mark?.lon).toBe(10.8701)
    expect(mark?.name).toBe('Sesvennahütte')
  })

  it('separates the two kinds of point with the filter the layers use', () => {
    const { layers } = collect()
    const features = referencePointFeatures([
      reference({ kind: 'route', waypoints: [{ lat: 47, lon: 11, name: 'Hut' }] }),
    ])

    const matches = (id: string) => {
      const layer = layers.find((entry) => entry.layer.id === id)?.layer as { filter: unknown }
      const filter = featureFilter(layer.filter as never, `${id}.filter`).filter
      const context = { zoom: 14 } as never
      return features.features.filter((feature) =>
        filter(context, { type: 1, properties: feature.properties } as never, null as never),
      ).length
    }

    expect(matches(REFERENCE_WPT_LAYER)).toBe(1)
    expect(matches(REFERENCE_VERTEX_LAYER)).toBe(2)
  })
})
