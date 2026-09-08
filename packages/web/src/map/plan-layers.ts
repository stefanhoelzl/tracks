import type { Leg, Waypoint } from '@tracks/routing'
import type { MapLibreMap } from 'maplibre-gl'
import { legGeometries } from '../lib/plan-track.ts'
import { highlightCasingPaint, highlightPaint, SELECTION } from './layers.ts'

/**
 * The plan, on the map.
 *
 * It wears the selected-track paint rather than a colour of its own, because it plays
 * exactly the role that styling was built for: the one thing you are looking at, over
 * everything else held at resting opacity. A second highlight colour would have to stay
 * legible over the vector basemap, the imagery and the hillshade to say what the
 * dimming underneath already says.
 *
 * One dash pattern, one meaning: **this is a straight line, not a route.** A leg that
 * could not be routed and a leg that has not been routed yet are the same claim as far
 * as the map is concerned, so they draw the same way — and the plan always has a shape,
 * which is what keeps its legs clickable while the router is slow, or unreachable.
 */

export const PLAN_SOURCE = 'plan'
export const PLAN_POINTS_SOURCE = 'plan-points'

export const PLAN_CASING_LAYER = 'plan-casing'
export const PLAN_LINE_LAYER = 'plan-line'
export const PLAN_FAILED_LAYER = 'plan-failed'
export const PLAN_SHAPING_LAYER = 'plan-shaping'
export const PLAN_POI_LAYER = 'plan-poi'
export const PLAN_POI_LABEL_LAYER = 'plan-poi-label'

/**
 * Below this a shaping point is noise: at valley scale it is the handle you reach for,
 * and at country scale it is a dot on a line whose shape is the only thing readable.
 */
const SHAPING_MIN_ZOOM = 10

interface LineFeature {
  type: 'Feature'
  /** `routed` is false for a beeline: unroutable, still in flight, or a drag preview. */
  properties: { leg: number; routed: boolean }
  geometry: { type: 'LineString'; coordinates: Array<[number, number]> }
}

interface Collection<F> {
  type: 'FeatureCollection'
  features: F[]
}

const EMPTY: Collection<never> = { type: 'FeatureCollection', features: [] }

/**
 * One feature per leg, carrying its own index so a click on the line knows which leg it
 * landed on — which is the whole of the nearest-leg rule, answered by MapLibre's hit
 * test rather than by geometry in the app.
 *
 * A leg with no answer yet still draws, as a straight line between its ends. Without
 * that, a plan whose router is slow or unreachable has no line at all — and no line
 * means nothing to click, so *insert here* and *shaping point* quietly stop being
 * offered for a reason nobody could see.
 */
export function routeFeatures(
  waypoints: readonly Waypoint[],
  legs: ReadonlyArray<Leg | undefined>,
): Collection<LineFeature> {
  return {
    type: 'FeatureCollection',
    features: legGeometries(waypoints, legs).map((coordinates, index) => ({
      type: 'Feature',
      properties: { leg: index, routed: legs[index]?.ok === true },
      geometry: { type: 'LineString', coordinates },
    })),
  }
}

/**
 * Straight lines between consecutive waypoints — what a drag shows while it is still a
 * drag. Instant, free, and honest about being provisional; the real request goes on
 * `dragend`, which is what keeps one gesture to one request rather than forty.
 */
export function beelineFeatures(waypoints: readonly Waypoint[]): Collection<LineFeature> {
  const features: LineFeature[] = []
  for (let i = 1; i < waypoints.length; i++) {
    const from = waypoints[i - 1]
    const to = waypoints[i]
    if (!from || !to) continue
    features.push({
      type: 'Feature',
      properties: { leg: -1, routed: false },
      geometry: {
        type: 'LineString',
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
      },
    })
  }
  return { type: 'FeatureCollection', features }
}

interface PointFeature {
  type: 'Feature'
  properties: { index: number; poi: boolean; label: string }
  geometry: { type: 'Point'; coordinates: [number, number] }
}

/** Index rides along, because every drag, rename and removal addresses a waypoint by it. */
export function waypointFeatures(waypoints: readonly Waypoint[]): Collection<PointFeature> {
  return {
    type: 'FeatureCollection',
    features: waypoints.map((waypoint, index) => ({
      type: 'Feature',
      properties: {
        index,
        poi: waypoint.kind === 'poi',
        label: waypoint.kind === 'poi' ? (waypoint.name ?? '') : '',
      },
      geometry: { type: 'Point', coordinates: [waypoint.lon, waypoint.lat] },
    })),
  }
}

export function addPlanLayers(map: MapLibreMap): void {
  map.addSource(PLAN_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(PLAN_POINTS_SOURCE, { type: 'geojson', data: EMPTY })

  map.addLayer({
    id: PLAN_CASING_LAYER,
    type: 'line',
    source: PLAN_SOURCE,
    filter: ['get', 'routed'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: highlightCasingPaint(),
  })

  map.addLayer({
    id: PLAN_LINE_LAYER,
    type: 'line',
    source: PLAN_SOURCE,
    filter: ['get', 'routed'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: highlightPaint(),
  })

  // Not a route: unroutable, or not answered yet. Dashed and uncased, so it reads as a
  // gap in the plan rather than as part of it — the shape survives, the claim does not.
  // It is still a full-width hit target, which is what keeps a leg clickable before the
  // router has said anything about it.
  map.addLayer({
    id: PLAN_FAILED_LAYER,
    type: 'line',
    source: PLAN_SOURCE,
    filter: ['!', ['get', 'routed']],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': SELECTION.SELECTED_OUTLINE,
      // Wide enough to be grabbed, faint enough not to read as a route. The two are
      // separable because a dash is what says "not a route", not the weight.
      'line-width': 4,
      'line-opacity': 0.5,
      'line-dasharray': [1.5, 2],
    },
  })

  // Subtle, and on the line rather than beside it: a shaping hint is a property of the
  // route, not a place on the map.
  map.addLayer({
    id: PLAN_SHAPING_LAYER,
    type: 'circle',
    source: PLAN_POINTS_SOURCE,
    filter: ['!', ['get', 'poi']],
    minzoom: SHAPING_MIN_ZOOM,
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': 3.5,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': SELECTION.SELECTED_OUTLINE,
      'circle-opacity': 0.9,
    },
  })

  map.addLayer({
    id: PLAN_POI_LAYER,
    type: 'circle',
    source: PLAN_POINTS_SOURCE,
    filter: ['get', 'poi'],
    paint: {
      'circle-color': SELECTION.SELECTED_OUTLINE,
      'circle-radius': 7,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#ffffff',
    },
  })

  map.addLayer({
    id: PLAN_POI_LABEL_LAYER,
    type: 'symbol',
    source: PLAN_POINTS_SOURCE,
    filter: ['get', 'poi'],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['noto_sans_bold'],
      'text-size': 12,
      'text-offset': [0, 1.1],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': SELECTION.SELECTED_OUTLINE,
      'text-halo-color': 'rgba(255, 255, 255, 0.92)',
      'text-halo-width': 1.6,
    },
  })
}

/** Whether the plan is on screen at all. Cheaper than tearing six layers down. */
export function showPlan(map: MapLibreMap, visible: boolean): void {
  // A style reload drops every layer this module added, and the effects that call this
  // do not know that happened — so check rather than throw into the console.
  if (!map.getLayer(PLAN_LINE_LAYER)) return
  for (const layer of [
    PLAN_CASING_LAYER,
    PLAN_LINE_LAYER,
    PLAN_FAILED_LAYER,
    PLAN_SHAPING_LAYER,
    PLAN_POI_LAYER,
    PLAN_POI_LABEL_LAYER,
  ]) {
    map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none')
  }
}
