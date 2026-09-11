import type { MapLibreMap } from 'maplibre-gl'
import type { Reference } from '../lib/references.ts'

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

export const REFERENCE_SOURCE = 'reference'
export const REFERENCE_POINTS_SOURCE = 'reference-points'

export const REFERENCE_LINE_LAYER = 'reference-line'
export const REFERENCE_VERTEX_LAYER = 'reference-vertex'
export const REFERENCE_WPT_LAYER = 'reference-wpt'
export const REFERENCE_WPT_LABEL_LAYER = 'reference-wpt-label'

/**
 * Below the plan's casing, so a reference never draws over the route you are drawing.
 *
 * Named rather than appended: `addLayer` with no `before` puts a layer on top, and the
 * plan layers are added at map load, before any file has been dropped.
 */
const BENEATH = 'plan-casing'

/** Thinner than the plan, which is 3.4: this is something you are looking at, not making. */
const LINE_WIDTH = 2.6

/**
 * Below this a route's own points are noise — the same judgement the plan's shaping
 * points make at the same zoom, for the same reason.
 */
const VERTEX_MIN_ZOOM = 11

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

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
  map.addSource(REFERENCE_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(REFERENCE_POINTS_SOURCE, { type: 'geojson', data: EMPTY })

  const before = map.getLayer(BENEATH) ? BENEATH : undefined

  map.addLayer(
    {
      id: REFERENCE_LINE_LAYER,
      type: 'line',
      source: REFERENCE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': LINE_WIDTH },
    },
    before,
  )

  // A route's own points, hollow so they read as the sparse thing they are.
  map.addLayer(
    {
      id: REFERENCE_VERTEX_LAYER,
      type: 'circle',
      source: REFERENCE_POINTS_SOURCE,
      filter: ['!', ['get', 'wpt']],
      minzoom: VERTEX_MIN_ZOOM,
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 3,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': ['get', 'colour'],
      },
    },
    before,
  )

  // Somebody else's mark, at its own coordinates. Smaller than a stop and hollow: it is
  // not part of your plan until you click it and say so.
  map.addLayer(
    {
      id: REFERENCE_WPT_LAYER,
      type: 'circle',
      source: REFERENCE_POINTS_SOURCE,
      filter: ['get', 'wpt'],
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 5,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': ['get', 'colour'],
      },
    },
    before,
  )

  map.addLayer(
    {
      id: REFERENCE_WPT_LABEL_LAYER,
      type: 'symbol',
      source: REFERENCE_POINTS_SOURCE,
      filter: ['get', 'wpt'],
      minzoom: VERTEX_MIN_ZOOM,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['noto_sans_regular'],
        'text-size': 11.5,
        'text-offset': [0, 0.9],
        'text-anchor': 'top',
        'text-optional': true,
      },
      paint: {
        'text-color': ['get', 'colour'],
        'text-halo-color': 'rgba(255, 255, 255, 0.92)',
        'text-halo-width': 1.6,
      },
    },
    before,
  )
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
