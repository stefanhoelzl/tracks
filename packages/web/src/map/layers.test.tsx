import {
  createPropertyExpression,
  featureFilter,
  latest,
  validateStyleMin,
} from '@maplibre/maplibre-gl-style-spec'
import type { TrackCollection } from '@tracks/core'
import type {
  AddLayerObject,
  Map as MapLibreMap,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import {
  addTrackLayers,
  OPACITY,
  paint,
  paintTracks,
  SELECTED_SOURCE,
  STARTS_SOURCE,
  startPoints,
  TRACKS_LAYER,
  TRACKS_SOURCE,
} from './layers.ts'

/**
 * The style this module builds, checked against the real MapLibre style spec.
 *
 * This exists because of a bug that reached the browser: `line-opacity` was written
 * as `['*', 0.85, ['interpolate', …, ['zoom'], …]]`, and MapLibre requires `zoom` to
 * be the direct input of a *top-level* `step` or `interpolate`. `addLayer` rejected
 * the layer, which meant `tracks-base` never existed, which meant every later
 * `setPaintProperty` on it threw too — one invalid expression, no map, and a console
 * full of consequences. Types cannot catch it; the spec validator can.
 */

/** Enough of a Map to capture what `addTrackLayers` would have built. */
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

  addTrackLayers(map)
  return { sources, layers }
}

function styleOf(sources: Record<string, SourceSpecification>, layers: AddLayerObject[]) {
  return {
    version: 8,
    // The glyph URL the symbol layers need to be legal in isolation; the real style
    // brings its own from VersaTiles.
    glyphs: 'https://example.invalid/{fontstack}/{range}.pbf',
    sources,
    layers,
  } as unknown as StyleSpecification
}

const TRACKS: TrackCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [11.0, 47.5],
          [11.1, 47.6],
        ],
      },
      properties: { id: 1, tags: ['sport:hike', 'trip:Alps'], year: 2025 },
    },
    {
      type: 'Feature',
      id: 2,
      geometry: { type: 'LineString', coordinates: [[13.0, 46.3]] },
      properties: { id: 2, tags: ['source:strava'], year: 2024 },
    },
  ],
}

describe('the track layers', () => {
  it('builds a style MapLibre accepts', () => {
    const { sources, layers } = collect()
    expect(validateStyleMin(styleOf(sources, layers))).toEqual([])
  })

  it('keeps zoom at the top of every opacity expression', () => {
    // The specific shape that broke: an interpolate over zoom nested inside another
    // expression. Validated directly, so the rule is stated and not just implied.
    const nested = {
      version: 8,
      sources: { s: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
      layers: [
        {
          id: 'l',
          type: 'line',
          source: 's',
          paint: {
            'line-opacity': ['*', 0.85, ['interpolate', ['linear'], ['zoom'], 7, 0, 8, 1]],
          },
        },
      ],
    } as unknown as StyleSpecification

    expect(validateStyleMin(nested)).not.toEqual([])
  })

  it('fades tracks in exactly as the painter restores them', () => {
    const { layers } = collect()
    const tracks = layers.find((l) => l.id === TRACKS_LAYER)!

    // What `addTrackLayers` paints and what `paintTracks` restores must be the same
    // expression, or releasing a hover would leave the map subtly dimmed.
    expect((tracks as { paint: Record<string, unknown> }).paint['line-opacity']).toEqual(
      OPACITY.fadeInTo(OPACITY.RESTING_OPACITY),
    )
  })

  /** Records what `paintTracks` would have written, and answers `getLayer`. */
  function painted(options: { focusId: number | null; grouped: boolean }) {
    const writes: Record<string, unknown> = {}
    const map = {
      getLayer: () => ({}),
      setFilter: (_id: string, filter: unknown) => {
        writes.filter = filter
      },
      setPaintProperty: (_id: string, property: string, value: unknown) => {
        writes[property] = value
      },
      setLayoutProperty: (id: string, property: string, value: unknown) => {
        writes[`${id}.${property}`] = value
      },
    } as unknown as MapLibreMap

    paintTracks(map, options)
    return writes
  }

  it('fades the tracks for the clusters only while it groups', () => {
    // Grouped, the tracks give way to donuts at low zoom, so opacity interpolates.
    // Ungrouped there is nothing to give way to, so it is a plain number.
    expect(painted({ focusId: null, grouped: true })['line-opacity']).toEqual(
      OPACITY.fadeInTo(OPACITY.RESTING_OPACITY),
    )
    expect(painted({ focusId: null, grouped: false })['line-opacity']).toBe(OPACITY.RESTING_OPACITY)
  })

  it('hides the start points when it is not grouping', () => {
    expect(painted({ focusId: null, grouped: true })['starts-circles.visibility']).toBe('visible')
    expect(painted({ focusId: null, grouped: false })['starts-circles.visibility']).toBe('none')
  })

  it('dims the rest around a focused track, grouped or not', () => {
    expect(painted({ focusId: 7, grouped: false })['line-opacity']).toBe(OPACITY.DIMMED_OPACITY)
    expect(painted({ focusId: 7, grouped: true })['line-opacity']).toEqual(
      OPACITY.fadeInTo(OPACITY.DIMMED_OPACITY),
    )
    expect(painted({ focusId: 7, grouped: true }).filter).toEqual(['==', ['get', 'id'], 7])
  })

  it('does nothing at all when its layers are gone', () => {
    // A style reload drops them, and the effects calling this cannot know that.
    const map = {
      getLayer: () => undefined,
      setPaintProperty: () => {
        throw new Error('should not paint a layer that is not there')
      },
    } as unknown as MapLibreMap

    expect(() => paintTracks(map, { focusId: null, grouped: true })).not.toThrow()
  })

  /**
   * Validation proves an expression is *well formed*; it says nothing about whether
   * the data it will meet can drive it. `circle-radius` was a legal `step` whose
   * input was `['get', 'point_count']` — null on every unclustered point, which
   * `step` cannot accept, so each lone start warned and fell back to a default
   * radius. Only evaluating it against a real feature finds that.
   *
   * Features are paired with the source they belong to, and built by the same
   * functions that build them at runtime: evaluating a track layer against a cluster
   * would fail on a combination that cannot occur.
   */
  const BY_SOURCE: Record<string, Array<{ name: string; properties: Record<string, unknown> }>> = {
    [TRACKS_SOURCE]: paint(TRACKS, 'sport').features.map((f) => ({
      name: `track ${f.properties.id}`,
      properties: f.properties,
    })),
    [STARTS_SOURCE]: [
      ...startPoints(TRACKS, 'sport').features.map((f) => ({
        name: `lone start ${f.properties.id}`,
        properties: f.properties as Record<string, unknown>,
      })),
      // What MapLibre's own clustering adds; nothing in this module produces it.
      { name: 'a cluster', properties: { point_count: 12, point_count_abbreviated: '12' } },
    ],
    [SELECTED_SOURCE]: [{ name: 'the selected track', properties: {} }],
  }

  it('evaluates every paint property against the features its source holds', () => {
    const { layers } = collect()

    for (const layer of layers) {
      const paintSpec = (latest as unknown as Record<string, Record<string, unknown>>)[
        `paint_${layer.type}`
      ]!
      const properties = (layer as { paint?: Record<string, unknown> }).paint ?? {}
      const features = BY_SOURCE[(layer as { source: string }).source]!

      // A layer only ever paints what its filter admits — clusters never reach the
      // lone-start layer, so evaluating one against it would fail on a pairing that
      // cannot happen. This is what MapLibre itself does before painting.
      const admits = featureFilter(
        (layer as { filter?: unknown }).filter as never,
        `${layer.id}.filter`,
      )

      for (const [property, value] of Object.entries(properties)) {
        // (expression, rootKey, propertySpec) — the middle argument only names the
        // property in error messages, and omitting it silently shifts the spec.
        const compiled = createPropertyExpression(value, property, paintSpec[property] as never)
        expect(compiled.result, `${layer.id}.${property} failed to compile`).toBe('success')
        if (compiled.result !== 'success') continue

        for (const feature of features) {
          for (const zoom of [5, 7, 8, 12]) {
            const geometry = { type: 1 as const }
            if (
              !admits.filter(
                { zoom },
                { properties: feature.properties, type: 1 } as never,
                geometry as never,
              )
            ) {
              continue
            }
            const where = `${layer.id}.${property} at z${zoom} on ${feature.name}`

            // `evaluate` swallows a bad evaluation: it warns once and returns the
            // property default, which is exactly why the null `point_count` reached
            // a browser instead of a test. The unhandled variant throws, so the
            // failure is a failure here.
            const out = (
              compiled.value as unknown as {
                evaluateWithoutErrorHandling: (g: unknown, f: unknown) => unknown
              }
            ).evaluateWithoutErrorHandling({ zoom }, { properties: feature.properties })

            expect(out, where).not.toBeUndefined()
            expect(out, where).not.toBeNull()
            if (typeof out === 'number') expect(Number.isFinite(out), where).toBe(true)
          }
        }
      }
    }
  })

  it('names a source for every layer it adds', () => {
    const { sources, layers } = collect()
    for (const layer of layers) {
      expect(Object.keys(sources)).toContain((layer as { source: string }).source)
    }
  })
})

describe('painting by value', () => {
  it('gives every feature a colour, stably, from its own tag', () => {
    const once = paint(TRACKS, 'sport')
    const again = paint(TRACKS, 'sport')

    expect(once.features[0]!.properties.colour).toBe(again.features[0]!.properties.colour)
    // The second activity has no sport, so it takes the neutral rather than a hue.
    expect(once.features[0]!.properties.colour).not.toBe(once.features[1]!.properties.colour)
  })

  it('recolours without touching geometry, which is what makes it free', () => {
    const bySport = paint(TRACKS, 'sport')
    const byYear = paint(TRACKS, 'year')

    expect(byYear.features[0]!.geometry).toEqual(bySport.features[0]!.geometry)
    expect(byYear.features[0]!.properties.colour).not.toBe(bySport.features[0]!.properties.colour)
  })

  it('derives one start point per track, from the payload already held', () => {
    const starts = startPoints(TRACKS, 'sport')
    expect(starts.features).toHaveLength(2)
    expect(starts.features[0]!.geometry.coordinates).toEqual([11.0, 47.5])
  })

  it('skips a track with no coordinates rather than emitting a broken point', () => {
    const empty: TrackCollection = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          id: 3,
          geometry: { type: 'LineString', coordinates: [] },
          properties: { id: 3, tags: [], year: 2023 },
        },
      ],
    }
    expect(startPoints(empty, null).features).toHaveLength(0)
  })
})
