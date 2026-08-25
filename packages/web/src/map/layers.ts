import type { TracksResponse } from '@tracks/core'
import type { ExpressionSpecification, MapLibreMap } from 'maplibre-gl'
import { activityColour, neutralColour } from '../lib/colour.ts'

/**
 * The track layers, and the rules for painting them.
 *
 * Colour is computed per feature and written into the data rather than expressed as
 * a MapLibre expression: `tags` is an array, and matching a prefix inside one is
 * exactly the thing style expressions cannot do. Recolouring 200 features is a map
 * over an array the browser already holds, so *colour by* repaints without a fetch.
 */

export const TRACKS_SOURCE = 'tracks'
export const STARTS_SOURCE = 'starts'
export const SELECTED_SOURCE = 'selected'

export const TRACKS_LAYER = 'tracks-base'
export const FOCUS_LAYER = 'tracks-focus'
export const STARTS_LAYER = 'starts-circles'
export const STARTS_COUNT_LAYER = 'starts-count'
export const SELECTED_LAYER = 'selected-track'

/**
 * Below this the map is about where you have been, not which way you went, so the
 * lines give way to clustered start points. The two cross-fade over one zoom level
 * rather than snapping, which is what keeps the transition from reading as a glitch.
 */
const CLUSTER_MAX_ZOOM = 8

type Coloured = TracksResponse['features'][number] & { properties: { colour: string } }

/** The same payload with a `colour` property baked in, ready for `setData`. */
export function paint(tracks: TracksResponse, colourBy: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.features.map(
      (feature): Coloured => ({
        ...feature,
        properties: {
          ...feature.properties,
          colour: activityColour(feature.properties.tags, feature.properties.year, colourBy),
        },
      }),
    ),
  }
}

/** Start points, derived from the tracks already in memory — no second request. */
export function startPoints(tracks: TracksResponse, colourBy: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.features.flatMap((feature) => {
      const start = feature.geometry.coordinates[0]
      if (!start) return []
      return [
        {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: start },
          properties: {
            id: feature.properties.id,
            colour: activityColour(feature.properties.tags, feature.properties.year, colourBy),
          },
        },
      ]
    }),
  }
}

const EMPTY = { type: 'FeatureCollection' as const, features: [] }

export function addTrackLayers(map: MapLibreMap): void {
  map.addSource(TRACKS_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(SELECTED_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(STARTS_SOURCE, {
    type: 'geojson',
    data: EMPTY,
    cluster: true,
    clusterMaxZoom: CLUSTER_MAX_ZOOM,
    clusterRadius: 44,
  })

  const fadeIn: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    CLUSTER_MAX_ZOOM - 1,
    0,
    CLUSTER_MAX_ZOOM,
    1,
  ]

  map.addLayer({
    id: TRACKS_LAYER,
    type: 'line',
    source: TRACKS_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'colour'],
      // Thin enough at country scale to show a shape rather than a blot, heavy
      // enough at valley scale to follow.
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 10, 2, 14, 3],
      'line-opacity': ['*', 0.85, fadeIn],
    },
  })

  // Drawn separately so focusing costs one filter change rather than a feature-state
  // write per track — and so the highlight can be wider than the line it replaces.
  map.addLayer({
    id: FOCUS_LAYER,
    type: 'line',
    source: TRACKS_SOURCE,
    filter: ['==', ['get', 'id'], -1],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'colour'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 10, 3.6, 14, 5],
      'line-opacity': 1,
    },
  })

  map.addLayer({
    id: SELECTED_LAYER,
    type: 'line',
    source: SELECTED_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#0f1513',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 10, 3.4, 14, 4.6],
    },
  })

  const fadeOut: ExpressionSpecification = [
    'interpolate',
    ['linear'],
    ['zoom'],
    CLUSTER_MAX_ZOOM - 1,
    1,
    CLUSTER_MAX_ZOOM,
    0,
  ]

  map.addLayer({
    id: STARTS_LAYER,
    type: 'circle',
    source: STARTS_SOURCE,
    paint: {
      // A cluster is grey because it holds several things; a lone start keeps the
      // colour of the activity it belongs to.
      'circle-color': ['case', ['has', 'point_count'], neutralColour(), ['get', 'colour']],
      'circle-radius': ['step', ['get', 'point_count'], 7, 5, 11, 20, 15, 50, 20],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': fadeOut,
      'circle-stroke-opacity': fadeOut,
    },
  })

  map.addLayer({
    id: STARTS_COUNT_LAYER,
    type: 'symbol',
    source: STARTS_SOURCE,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['noto_sans_bold'],
      'text-size': 11,
    },
    paint: { 'text-color': '#ffffff', 'text-opacity': fadeOut },
  })
}

/** Everything but the focused track recedes, so the focused one is legible over it. */
export function setFocus(map: MapLibreMap, id: number | null): void {
  map.setFilter(FOCUS_LAYER, ['==', ['get', 'id'], id ?? -1])
  map.setPaintProperty(TRACKS_LAYER, 'line-opacity', [
    '*',
    id === null ? 0.85 : 0.18,
    ['interpolate', ['linear'], ['zoom'], CLUSTER_MAX_ZOOM - 1, 0, CLUSTER_MAX_ZOOM, 1],
  ])
}
