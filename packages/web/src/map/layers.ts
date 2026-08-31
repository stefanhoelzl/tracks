import type { TrackCollection } from '@tracks/core'
import type { ExpressionSpecification, MapLibreMap } from 'maplibre-gl'
import { activityColour, activitySlot, type ColourScale, HASHED } from '../lib/colour.ts'
import { clusterProperties } from './clusters.ts'

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
export const SELECTED_CASING_LAYER = 'selected-track-casing'
export const SELECTED_LAYER = 'selected-track'

/**
 * Below this the map is about where you have been, not which way you went, so the
 * lines give way to clustered start points. The two cross-fade over one zoom level
 * rather than snapping, which is what keeps the transition from reading as a glitch.
 */
const CLUSTER_MAX_ZOOM = 8

/** Only reached by a selected feature built without a colour, which nothing does. */
const SELECTED_FALLBACK = '#0f1513'

/**
 * What every track is drawn at, focused or not.
 *
 * Nothing recedes when one track is picked out. Dimming the rest answered "which one
 * is it?" by deleting the context that made the answer worth having — where this ride
 * sits among the others is the reason to look at a map of all of them at once.
 */
const RESTING_OPACITY = 0.85

/**
 * A zoom fade that ends at `opacity`.
 *
 * The multiplication has to live in the interpolate's own output stops: MapLibre
 * requires `zoom` to be the direct input of a *top-level* `step` or `interpolate`,
 * so wrapping one in `['*', k, …]` is rejected at `addLayer` — which takes the layer
 * with it, and every later `setPaintProperty` on it.
 */
function fadeInTo(opacity: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], CLUSTER_MAX_ZOOM - 1, 0, CLUSTER_MAX_ZOOM, opacity]
}

/** The inverse, for the clustered start points that hand over to the lines. */
function fadeOutFrom(opacity: number): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], CLUSTER_MAX_ZOOM - 1, opacity, CLUSTER_MAX_ZOOM, 0]
}

type Coloured = TrackCollection['features'][number] & { properties: { colour: string } }

/** The same payload with a `colour` property baked in, ready for `setData`. */
export function paint(
  tracks: TrackCollection,
  colourBy: string | null,
  scale: ColourScale = HASHED,
) {
  return {
    type: 'FeatureCollection' as const,
    features: tracks.features.map(
      (feature): Coloured => ({
        ...feature,
        properties: {
          ...feature.properties,
          colour: activityColour(feature.properties.tags, feature.properties.year, colourBy, scale),
        },
      }),
    ),
  }
}

/** Start points, derived from the tracks already in memory — no second request. */
export function startPoints(
  tracks: TrackCollection,
  colourBy: string | null,
  scale: ColourScale = HASHED,
) {
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
            colour: activityColour(
              feature.properties.tags,
              feature.properties.year,
              colourBy,
              scale,
            ),
            // The donut tally is summed over this by MapLibre's own clusterer.
            slot: activitySlot(feature.properties.tags, feature.properties.year, colourBy, scale),
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
    // Eleven counters, one per palette slot: the tally each donut is drawn from.
    clusterProperties: clusterProperties(),
  })

  map.addLayer({
    id: TRACKS_LAYER,
    type: 'line',
    source: TRACKS_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'colour'],
      // Thin enough at country scale to show a shape rather than a blot, heavy
      // enough at valley scale to follow.
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.8, 10, 3, 14, 4.5],
      'line-opacity': fadeInTo(RESTING_OPACITY),
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
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3.2, 10, 5, 14, 7],
      'line-opacity': 1,
    },
  })

  // A halo, not a colour. Painting the selection black said "this is a different kind
  // of thing" when what it means is "this is the one you picked" — and it threw away
  // the sport or trip the colour was carrying. A casing separates it from whatever it
  // crosses while its own colour stays the colour it always was.
  map.addLayer({
    id: SELECTED_CASING_LAYER,
    type: 'line',
    source: SELECTED_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 7, 10, 10, 14, 13],
      'line-opacity': 0.9,
    },
  })

  map.addLayer({
    id: SELECTED_LAYER,
    type: 'line',
    source: SELECTED_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      // Coalesced: `line-color` is not optional, and a feature arriving without one
      // would take the whole layer down rather than draw in the wrong colour.
      'line-color': ['coalesce', ['get', 'colour'], SELECTED_FALLBACK],
      'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3.6, 10, 5.4, 14, 7.5],
    },
  })

  // Only the lone starts. A cluster is a mixture, and a circle layer can paint one
  // colour per feature — so clusters are drawn as donut markers over the canvas.
  map.addLayer({
    id: STARTS_LAYER,
    type: 'circle',
    source: STARTS_SOURCE,
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['get', 'colour'],
      'circle-radius': 7,
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': fadeOutFrom(1),
      'circle-stroke-opacity': fadeOutFrom(1),
    },
  })
}

/**
 * How the tracks are painted right now: what is focused, and whether the map groups.
 *
 * One function rather than two because both decide `line-opacity`, and two writers
 * of one property means whichever ran last wins — releasing a hover would undo the
 * grouping toggle, or the other way about.
 *
 * Ungrouped, the tracks simply never fade: there are no clusters to hand over to, so
 * the zoom interpolation that made room for them has nothing left to do.
 */
export function paintTracks(
  map: MapLibreMap,
  { focusId, grouped }: { focusId: number | null; grouped: boolean },
): void {
  // A style reload drops every layer this module added, and the effects that call
  // this do not know that happened — so check rather than throw into the console.
  if (!map.getLayer(TRACKS_LAYER)) return

  map.setFilter(FOCUS_LAYER, ['==', ['get', 'id'], focusId ?? -1])
  map.setPaintProperty(
    TRACKS_LAYER,
    'line-opacity',
    grouped ? fadeInTo(RESTING_OPACITY) : RESTING_OPACITY,
  )
  map.setLayoutProperty(STARTS_LAYER, 'visibility', grouped ? 'visible' : 'none')
}

/** Exported for the style-spec test, which validates what `addTrackLayers` builds. */
export const OPACITY = { RESTING_OPACITY, fadeInTo, fadeOutFrom }
