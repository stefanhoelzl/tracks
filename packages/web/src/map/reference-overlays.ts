import type { Overlays } from './overlay-spec.ts'

/**
 * The layers dropped files are drawn with — see `reference-layers.ts` for what they are and how
 * their features are made. Apart from it so the phone's copy of the overlays, which has no files,
 * builds without the GPX parser the features are made from.
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
 * Named rather than left to the list's order: the web adds the plan's layers first.
 */
const BENEATH = 'plan-casing'

/** Thinner than the plan, which is 3.4: this is something you are looking at, not making. */
const LINE_WIDTH = 2.6

/**
 * Below this a route's own points are noise — the same judgement the plan's shaping
 * points make at the same zoom, for the same reason.
 */
const VERTEX_MIN_ZOOM = 11

const EMPTY = { type: 'FeatureCollection' as const, features: [] }

const WEB = { platforms: ['web'], before: BENEATH } as const

/** The web's own: a phone has no files dropped on it. */
export const REFERENCE_OVERLAYS: Overlays = {
  sources: {
    [REFERENCE_SOURCE]: { type: 'geojson', data: EMPTY, metadata: WEB },
    [REFERENCE_POINTS_SOURCE]: { type: 'geojson', data: EMPTY, metadata: WEB },
  },
  layers: [
    {
      id: REFERENCE_LINE_LAYER,
      type: 'line',
      source: REFERENCE_SOURCE,
      metadata: WEB,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'colour'], 'line-width': LINE_WIDTH },
    },

    // A route's own points, hollow so they read as the sparse thing they are.
    {
      id: REFERENCE_VERTEX_LAYER,
      type: 'circle',
      source: REFERENCE_POINTS_SOURCE,
      filter: ['!', ['get', 'wpt']],
      minzoom: VERTEX_MIN_ZOOM,
      metadata: WEB,
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 3,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': ['get', 'colour'],
      },
    },

    // Somebody else's mark, at its own coordinates. Smaller than a stop and hollow: it is
    // not part of your plan until you click it and say so.
    {
      id: REFERENCE_WPT_LAYER,
      type: 'circle',
      source: REFERENCE_POINTS_SOURCE,
      filter: ['get', 'wpt'],
      metadata: WEB,
      paint: {
        'circle-color': '#ffffff',
        'circle-radius': 5,
        'circle-stroke-width': 2.5,
        'circle-stroke-color': ['get', 'colour'],
      },
    },

    {
      id: REFERENCE_WPT_LABEL_LAYER,
      type: 'symbol',
      source: REFERENCE_POINTS_SOURCE,
      filter: ['get', 'wpt'],
      minzoom: VERTEX_MIN_ZOOM,
      metadata: WEB,
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
  ],
}
