import type { Leg, Waypoint } from '@tracks/routing'
import type { ExpressionSpecification, MapLibreMap } from 'maplibre-gl'
import { RIDDEN_COLOUR } from '../lib/colour.ts'
import { legGeometries } from '../lib/plan-track.ts'
import {
  CURSOR_LAYER,
  CURSOR_SOURCE,
  RANGE_CASING_LAYER,
  RANGE_LAYER,
  RANGE_SOURCE,
  SELECTION,
} from './layers.ts'
import { addOverlays, type Overlays } from './overlay-spec.ts'

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

/** The phone's own: the ride being recorded, and where the phone faces. */
export const RIDDEN_SOURCE = 'ridden'
export const RIDDEN_LAYER = 'ridden'
export const RIDER_SOURCE = 'rider'
export const RIDER_FACING_LAYER = 'rider-facing'

/** The image the facing cone is drawn with, painted by the phone at runtime in `metadata.imageColour`. */
export const RIDER_FACING_IMAGE = 'rider-facing'

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
/** `--accent`: the plan is the thing you edit, so it wears the interactive colour. */
export const ACCENT = '#0d8a5f'

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

/**
 * The white border around a stretch picked out on the elevation profile: wider than the plan's own
 * casing, so the stretch reads as picked out of the line rather than as a second line beside it.
 * Drawn at the plan's weight, over a line held back to `HELD_BACK`, which is what it is picked out of.
 */
const RANGE_CASING_WIDTH: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  6,
  5.6,
  10,
  7.4,
  14,
  9.2,
]

/**
 * A waypoint a finger has picked up, on the phone, before it is dragged: drawn larger, so it
 * shows it has been. The web drags with a pointer, which needs no such sign, and never sets it.
 */
const HELD: ExpressionSpecification = ['==', ['get', 'held'], true]

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

const BOTH = undefined
const WEB = { platforms: ['web'] } as const
const APP = { platforms: ['app'] } as const

const ROUND = { 'line-cap': 'round', 'line-join': 'round' } as const

/**
 * The plan and what is said about it: the stretch picked out on its profile, the cursor on it, and
 * on the phone the ride over it and the cone where the phone faces.
 */
export const PLAN_OVERLAYS: Overlays = {
  sources: {
    [PLAN_SOURCE]: { type: 'geojson', data: EMPTY, metadata: BOTH },
    [PLAN_POINTS_SOURCE]: { type: 'geojson', data: EMPTY, metadata: BOTH },
    [PLAN_PREVIEW_SOURCE]: { type: 'geojson', data: EMPTY, metadata: WEB },
    [RANGE_SOURCE]: { type: 'geojson', data: EMPTY, metadata: BOTH },
    [CURSOR_SOURCE]: { type: 'geojson', data: EMPTY, metadata: BOTH },
    [RIDDEN_SOURCE]: { type: 'geojson', data: EMPTY, metadata: APP },
    [RIDER_SOURCE]: { type: 'geojson', data: EMPTY, metadata: APP },
  },
  layers: [
    {
      id: PLAN_CASING_LAYER,
      type: 'line',
      source: PLAN_SOURCE,
      filter: ['get', 'routed'],
      layout: ROUND,
      paint: {
        'line-color': SELECTION.SELECTED_OUTLINE,
        'line-width': ROUTE_CASING_WIDTH,
        'line-opacity': 0.55,
      },
    },
    {
      id: PLAN_LINE_LAYER,
      type: 'line',
      source: PLAN_SOURCE,
      filter: ['get', 'routed'],
      layout: ROUND,
      paint: { 'line-color': ACCENT, 'line-width': ROUTE_WIDTH },
    },

    // Over the plan, at the plan's weight: where you went, drawn on where you meant to.
    {
      id: RIDDEN_LAYER,
      type: 'line',
      source: RIDDEN_SOURCE,
      metadata: APP,
      layout: ROUND,
      paint: { 'line-color': RIDDEN_COLOUR, 'line-width': ROUTE_WIDTH },
    },

    // Not a route, and never going to be one: the engine could not connect these two.
    // Dashed and uncased, so it reads as a gap in the plan rather than as part of it — the
    // shape survives, the claim does not. Still a full-width hit target, which is what
    // keeps the leg draggable even though it has no route to shape yet.
    {
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
    },

    // Not a route *yet*. The same dash in the plan's own colour, and each side pulses its
    // opacity while any leg is outstanding — the one place where something moves on its
    // own, because it is the one place that is waiting on somebody else.
    {
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
    },

    // The stretch the two bars on the elevation profile enclose, over the line it is part of.
    // It **keeps that line's own colour** — `colourHi`, or the plan's or the ride's on the phone,
    // which says which by `role` — and is picked out by a white casing rather than by being
    // repainted: a stretch drawn in ink would answer *which piece* by destroying the answer to
    // *what is this line*, which is the colour it is drawn in.
    {
      id: RANGE_CASING_LAYER,
      type: 'line',
      source: RANGE_SOURCE,
      layout: ROUND,
      paint: { 'line-color': '#ffffff', 'line-width': RANGE_CASING_WIDTH },
    },
    {
      id: RANGE_LAYER,
      type: 'line',
      source: RANGE_SOURCE,
      layout: ROUND,
      paint: {
        'line-color': [
          'coalesce',
          ['get', 'colourHi'],
          ['match', ['get', 'role'], 'ridden', RIDDEN_COLOUR, ACCENT],
        ],
        'line-width': ROUTE_WIDTH,
      },
    },

    // Subtle, and on the line rather than beside it: a shaping hint is a property of the
    // route, not a place on the map. It wears the route's colour for the same reason the
    // route does — leaving one part of the plan dark would read as an oversight.
    {
      id: PLAN_SHAPING_LAYER,
      type: 'circle',
      source: PLAN_POINTS_SOURCE,
      filter: ['!', ['get', 'poi']],
      minzoom: SHAPING_MIN_ZOOM,
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': ['case', HELD, 6, 3.5],
        'circle-stroke-width': ['case', HELD, 2, 1.5],
        'circle-stroke-color': ACCENT,
        'circle-opacity': ['case', HELD, 1, 0.9],
      },
    },

    // A stop is the plan, so it is the plan's colour, ringed in white to hold against
    // the terrain the way every other marker on this map does.
    {
      id: PLAN_POI_LAYER,
      type: 'circle',
      source: PLAN_POINTS_SOURCE,
      filter: ['get', 'poi'],
      paint: {
        'circle-color': ACCENT,
        'circle-radius': ['case', HELD, 11, 7],
        'circle-stroke-width': ['case', HELD, 3, 2.5],
        'circle-stroke-color': '#ffffff',
      },
    },

    // A ring rather than a pin: the place under the pointer in a list of results is not
    // part of the plan, and drawing it like a stop would say it was. Hollow, accent-
    // coloured, and above everything, because it is answering "which one is that?".
    {
      id: PLAN_PREVIEW_LAYER,
      type: 'circle',
      source: PLAN_PREVIEW_SOURCE,
      metadata: WEB,
      paint: {
        'circle-color': 'rgba(13, 138, 95, 0.18)',
        'circle-radius': 11,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': ACCENT,
      },
    },

    {
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
    },

    // Where the elevation profile's cursor is, or a place picked off the map on the phone.
    // White with the same dark outline everything else is cased in — the one combination
    // that holds against the pale basemap, the satellite imagery and the line underneath,
    // which between them cover every value a single flat colour could have been.
    {
      id: CURSOR_LAYER,
      type: 'circle',
      source: CURSOR_SOURCE,
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 7,
        'circle-stroke-width': 3,
        'circle-stroke-color': SELECTION.SELECTED_OUTLINE,
      },
    },

    // Where the phone faces: a fading cone out of the rider, from the compass rather than the
    // course — what a rider stopped at a junction wants to know, and a course cannot say.
    // Turned with the map, so it points the same way whichever way up the map is; under the
    // rider's dot, which the phone draws over everything. Its blue is not the accent, which the
    // plan line is and which a cone lying along it would vanish into.
    {
      id: RIDER_FACING_LAYER,
      type: 'symbol',
      source: RIDER_SOURCE,
      metadata: { ...APP, imageColour: '#2f6fd6' },
      layout: {
        'icon-image': RIDER_FACING_IMAGE,
        'icon-anchor': 'center',
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
  ],
}

export function addPlanLayers(map: MapLibreMap): void {
  addOverlays(map, PLAN_OVERLAYS)
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
