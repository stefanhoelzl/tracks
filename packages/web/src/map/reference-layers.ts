import type { MapLibreMap } from 'maplibre-gl'
import type { Reference } from '../lib/references.ts'
import { addOverlays } from './overlay-spec.ts'
import {
  REFERENCE_LINE_LAYER,
  REFERENCE_OVERLAYS,
  REFERENCE_VERTEX_LAYER,
  REFERENCE_WPT_LABEL_LAYER,
  REFERENCE_WPT_LAYER,
} from './reference-overlays.ts'

/**
 * Dropped files, on the map.
 *
 * Between the two things already here: above the activities, which are dimmed and inert
 * while you plan, and below the plan, which is the thing you are making. That order is
 * the whole statement — a reference is data you are reading, like a ride, but it is the
 * data you dropped in on purpose, so it is not dimmed with the rest.
 *
 * It does **not** wear the accent. The accent has meant *interactive, never data* since
 * M3, and a foreign route is data; it wears a palette colour instead, hashed exactly as
 * a tag value is, so the row's dot in the panel is a legend that already means
 * something. Nor does it wear a dash: one dash pattern, one meaning, and that meaning is
 * already *this is a straight line, not a route*.
 */

export {
  REFERENCE_LINE_LAYER,
  REFERENCE_POINTS_SOURCE,
  REFERENCE_SOURCE,
  REFERENCE_VERTEX_LAYER,
  REFERENCE_WPT_LABEL_LAYER,
  REFERENCE_WPT_LAYER,
} from './reference-overlays.ts'

/**
 * One line per part, plus the points of a `<rte>` and nothing for a `<trk>`.
 *
 * A route is turn instructions between sparse points, so drawn as a polyline it cuts
 * every corner it comes to. Marking its vertices is what makes that read as *sparse*
 * rather than as *wrong* — a track, being a recording, needs no such apology.
 */
export function referenceFeatures(references: readonly Reference[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: references
      .filter((reference) => reference.points.length >= 2)
      .map((reference) => ({
        type: 'Feature',
        properties: {
          id: reference.id,
          colour: reference.colour,
          route: reference.kind === 'route',
        },
        geometry: {
          type: 'LineString',
          coordinates: reference.points.map((point) => [point.lon, point.lat]),
        },
      })),
  }
}

/** The file's own `<wpt>`s, and a route's vertices. Both are points on this source. */
export function referencePointFeatures(
  references: readonly Reference[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []

  for (const reference of references) {
    for (const waypoint of reference.waypoints) {
      features.push({
        type: 'Feature',
        properties: {
          colour: reference.colour,
          label: waypoint.name ?? '',
          name: waypoint.name ?? '',
          lat: waypoint.lat,
          lon: waypoint.lon,
          wpt: true,
        },
        geometry: { type: 'Point', coordinates: [waypoint.lon, waypoint.lat] },
      })
    }

    if (reference.kind !== 'route') continue
    for (const point of reference.points) {
      features.push({
        type: 'Feature',
        properties: { colour: reference.colour, wpt: false },
        geometry: { type: 'Point', coordinates: [point.lon, point.lat] },
      })
    }
  }

  return { type: 'FeatureCollection', features }
}

export function addReferenceLayers(map: MapLibreMap): void {
  addOverlays(map, REFERENCE_OVERLAYS)
}

/** Whether references are on screen at all — they exist only while planning. */
export function showReferences(map: MapLibreMap, visible: boolean): void {
  if (!map.getLayer(REFERENCE_LINE_LAYER)) return
  for (const layer of [
    REFERENCE_LINE_LAYER,
    REFERENCE_VERTEX_LAYER,
    REFERENCE_WPT_LAYER,
    REFERENCE_WPT_LABEL_LAYER,
  ]) {
    map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none')
  }
}
