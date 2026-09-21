import type { Overlays } from './overlay-spec.ts'

/**
 * Contours, generated from the DEM by `maplibre-contour` in a worker (see `basemap.ts`), so no
 * contour tileset has to exist anywhere.
 *
 * The web's alone: the tiles come from a custom protocol that only MapLibre GL JS can register,
 * so the source names `{contours}` and `basemap.ts` fills in the URL the protocol hands back.
 */

export const CONTOUR_SOURCE = 'contours'

/** The placeholder the source's tiles name until the web fills in the protocol's URL. */
export const CONTOUR_TILES = '{contours}'

/** Contours appear only when the terrain is worth reading, and never label the overview. */
export const CONTOUR_MIN_ZOOM = 11

export const CONTOUR_OVERLAYS: Overlays = {
  sources: {
    [CONTOUR_SOURCE]: {
      type: 'vector',
      tiles: [CONTOUR_TILES],
      maxzoom: 15,
      metadata: { platforms: ['web'] },
    },
  },
  layers: [
    {
      id: 'contour-lines',
      type: 'line',
      source: CONTOUR_SOURCE,
      'source-layer': 'contours',
      minzoom: CONTOUR_MIN_ZOOM,
      metadata: { platforms: ['web'] },
      paint: {
        // Darker and a touch more opaque than the grey basemap wanted: a contour has
        // to stay legible crossing woodland, not only crossing paper.
        'line-color': 'rgba(74, 88, 82, 0.45)',
        // Index lines carry the labels, so they carry the weight too.
        'line-width': ['match', ['get', 'level'], 1, 1, 0.5],
      },
    },
    {
      id: 'contour-labels',
      type: 'symbol',
      source: CONTOUR_SOURCE,
      'source-layer': 'contours',
      minzoom: CONTOUR_MIN_ZOOM + 1,
      filter: ['>', ['get', 'level'], 0],
      metadata: { platforms: ['web'] },
      layout: {
        'symbol-placement': 'line',
        'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'],
        'text-font': ['noto_sans_regular'],
        'text-size': 9.5,
        'text-max-angle': 25,
      },
      paint: {
        'text-color': 'rgba(58, 72, 66, 0.95)',
        // A denser halo, for the same reason: the label now has colour behind it.
        'text-halo-color': 'rgba(244, 246, 243, 0.92)',
        'text-halo-width': 1.6,
      },
    },
  ],
}
