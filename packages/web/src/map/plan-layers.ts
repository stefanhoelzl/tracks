import type { Leg, Waypoint } from '@tracks/routing'
import type { ExpressionSpecification, MapLibreMap } from 'maplibre-gl'
import { legGeometries } from '../lib/plan-track.ts'
import { SELECTION } from './layers.ts'

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
export const PLAN_PREVIEW_SOURCE = 'plan-preview'

export const PLAN_CASING_LAYER = 'plan-casing'
export const PLAN_LINE_LAYER = 'plan-line'
export const PLAN_FAILED_LAYER = 'plan-failed'
export const PLAN_SHAPING_LAYER = 'plan-shaping'
export const PLAN_POI_LAYER = 'plan-poi'
export const PLAN_POI_LABEL_LAYER = 'plan-poi-label'
export const PLAN_PENDING_LAYER = 'plan-pending'
export const PLAN_PREVIEW_LAYER = 'plan-preview-ring'

/**
 * The plan's own colour, mirrored from `--accent` in the token file.
 *
 * Written here rather than read from CSS for the reason the palette and the chart
 * colours are: MapLibre paints from JSON, where `var(--accent)` is a string and not a
 * colour, and an invalid one fails silently as an invisible line.
 *
 * A plan is the one thing on this map that is not data — it is a thing you are making,
 * which is what the accent has always meant. Borrowing the selected-track highlight said
 * "the track you mean" instead, and put a plan and a ride in the same voice.
 */
const ACCENT = '#0d8a5f'

/**
 * Below this a shaping point is noise: at valley scale it is the handle you reach for,
 * and at country scale it is a dot on a line whose shape is the only thing readable.
 */
const SHAPING_MIN_ZOOM = 10

/**
 * How faint a leg waiting on the router gets, and how solid, once a second.
 *
 * Exported so the animation and the layer that rests at `rest` cannot drift apart.
 */
export const PENDING_OPACITY = { rest: 0.55, low: 0.2, periodMs: 1100 }

/**
 * The plan's own weights, lighter than a selected track's.
 *
 * It borrowed the highlight's at first, which is what a selected activity wears to say
 * *this is the one you mean* among two hundred others. A plan has no competition — it is
 * the only route on the map — so the weight was doing no work and read as shouting. Thin
 * enough to see the road it is following, cased just enough to hold against the terrain.
 */
const ROUTE_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  2,
  10,
  2.8,
  14,
  3.6,
]
const ROUTE_CASING_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  3.6,
  10,
  4.8,
  14,
  6,
]

interface LineFeature {
  type: 'Feature'
  /**
   * `routed` is false for a beeline: unroutable, still in flight, or a drag preview.
   * `pending` separates the second of those from the first, because a leg that is still
   * being worked on should pulse and a leg that cannot be routed must not — a failure
   * that looks like it is loading is a failure nobody stops waiting for.
   */
  properties: { leg: number; routed: boolean; pending: boolean }
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
      properties: {
        leg: index,
        routed: legs[index]?.ok === true,
        pending: legs[index] === undefined,
      },
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
      properties: { leg: -1, routed: false, pending: false },
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

/** Where a search result is, while the pointer is on its row. Nothing, otherwise. */
export function previewFeature(at: { lat: number; lon: number } | null): Collection<PointFeature> {
  if (!at) return EMPTY
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { index: -1, poi: true, label: '' },
        geometry: { type: 'Point', coordinates: [at.lon, at.lat] },
      },
    ],
  }
}

export function addPlanLayers(map: MapLibreMap): void {
  map.addSource(PLAN_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(PLAN_POINTS_SOURCE, { type: 'geojson', data: EMPTY })
  map.addSource(PLAN_PREVIEW_SOURCE, { type: 'geojson', data: EMPTY })

  map.addLayer({
    id: PLAN_CASING_LAYER,
    type: 'line',
    source: PLAN_SOURCE,
    filter: ['get', 'routed'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': SELECTION.SELECTED_OUTLINE,
      'line-width': ROUTE_CASING_WIDTH,
      'line-opacity': 0.55,
    },
  })

  map.addLayer({
    id: PLAN_LINE_LAYER,
    type: 'line',
    source: PLAN_SOURCE,
    filter: ['get', 'routed'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ACCENT, 'line-width': ROUTE_WIDTH },
  })

  // Not a route, and never going to be one: the engine could not connect these two.
  // Dashed and uncased, so it reads as a gap in the plan rather than as part of it — the
  // shape survives, the claim does not. Still a full-width hit target, which is what
  // keeps the leg draggable even though it has no route to shape yet.
  map.addLayer({
    id: PLAN_FAILED_LAYER,
    type: 'line',
    source: PLAN_SOURCE,
    filter: ['all', ['!', ['get', 'routed']], ['!', ['get', 'pending']]],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': SELECTION.SELECTED_OUTLINE,
      // Wide enough to be grabbed, faint enough not to read as a route. The two are
      // separable because a dash is what says "not a route", not the weight.
      'line-width': 3,
      'line-opacity': 0.5,
      'line-dasharray': [2, 2.5],
    },
  })

  // Not a route *yet*. The same dash in the plan's own colour, and `MapView` pulses its
  // opacity while any leg is outstanding — the one place in this app where something
  // moves on its own, because it is the one place that is waiting on somebody else.
  map.addLayer({
    id: PLAN_PENDING_LAYER,
    type: 'line',
    source: PLAN_SOURCE,
    filter: ['get', 'pending'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: {
      'line-color': ACCENT,
      'line-width': 3,
      'line-opacity': PENDING_OPACITY.rest,
      'line-dasharray': [2, 2.5],
    },
  })

  // Subtle, and on the line rather than beside it: a shaping hint is a property of the
  // route, not a place on the map. It wears the route's colour for the same reason the
  // route does — leaving one part of the plan dark would read as an oversight.
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
      'circle-stroke-color': ACCENT,
      'circle-opacity': 0.9,
    },
  })

  // A stop is the plan, so it is the plan's colour, ringed in white to hold against
  // the terrain the way every other marker on this map does.
  map.addLayer({
    id: PLAN_POI_LAYER,
    type: 'circle',
    source: PLAN_POINTS_SOURCE,
    filter: ['get', 'poi'],
    paint: {
      'circle-color': ACCENT,
      'circle-radius': 7,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': '#ffffff',
    },
  })

  // A ring rather than a pin: the place under the pointer in a list of results is not
  // part of the plan, and drawing it like a stop would say it was. Hollow, accent-
  // coloured, and above everything, because it is answering "which one is that?".
  map.addLayer({
    id: PLAN_PREVIEW_LAYER,
    type: 'circle',
    source: PLAN_PREVIEW_SOURCE,
    paint: {
      'circle-color': 'rgba(13, 138, 95, 0.18)',
      'circle-radius': 11,
      'circle-stroke-width': 2.5,
      'circle-stroke-color': ACCENT,
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
    PLAN_PENDING_LAYER,
    PLAN_PREVIEW_LAYER,
  ]) {
    map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none')
  }
}
