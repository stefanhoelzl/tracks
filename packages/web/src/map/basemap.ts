import { colorful, satellite } from '@versatiles/style'
import mlcontour from 'maplibre-contour'
import type { StyleSpecification } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
// `?worker&url` bundles the worker *and its imports*, then hands back the URL — see below.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

/**
 * The basemap, in one module.
 *
 * Swapping providers or dropping to a locally-served VersaTiles container is meant
 * to be a one-line change, which only stays true while every tile URL and every
 * style decision lives here.
 */

/**
 * Where MapLibre's worker lives.
 *
 * MapLibre resolves its own worker as a sibling of `import.meta.url`. After bundling
 * that is `assets/index-<hash>.js`, and no `maplibre-gl-worker.mjs` sits beside it —
 * the reference is built at runtime from a string, so Vite never sees it and never
 * emits it.
 *
 * `?worker` rather than a plain `?url`: the shipped worker imports a shared chunk of
 * its own, and a plain `?url` copies the file verbatim with that import dangling. The
 * worker plugin bundles it and its dependencies into one module, and `&url` hands back
 * the address instead of a constructor, which is what `setWorkerUrl` wants.
 */
maplibregl.setWorkerUrl(workerUrl)

const TILES = 'https://tiles.versatiles.org'

/** Terrarium-encoded, 512 px, z0–12. The same source feeds hillshade and contours. */
const ELEVATION = `${TILES}/tiles/elevation/{z}/{x}/{y}`

/** The same server's raster imagery, WebP. */
const SATELLITE = `${TILES}/tiles/satellite/{z}/{x}/{y}`

/**
 * VersaTiles' own hillshade, tuned down.
 *
 * Relief has to stay under everything: a warm highlight and a cool shadow at low
 * exaggeration reads as terrain without competing with the landcover beneath it or
 * with a line drawn on top.
 */
const HILLSHADE = {
  shadowColor: '#4a5a63',
  highlightColor: '#fffaf0',
  accentColor: '#8a9691',
  exaggeration: 0.35,
  illuminationDirection: 315,
} as const

/** Contours appear only when the terrain is worth reading, and never label the overview. */
const CONTOUR_MIN_ZOOM = 11

const CONTOUR_SOURCE = 'contours'

/**
 * `maplibre-contour` generates contour vector tiles from the DEM in a worker and
 * serves them over a custom protocol, so no contour tileset has to exist anywhere.
 * Registered once per page — the protocol name is global to MapLibre.
 */
let contourUrl: string | null = null

function contourTiles(): string {
  if (contourUrl) return contourUrl

  const source = new mlcontour.DemSource({
    url: ELEVATION,
    encoding: 'terrarium',
    maxzoom: 12,
    worker: true,
  })
  source.setupMaplibre(maplibregl)

  contourUrl = source.contourProtocolUrl({
    // 100 m minor lines with every fifth promoted to an index line: the interval a
    // 1:25 000 outdoor map uses, and legible at the zooms these appear at.
    thresholds: { 11: [200, 1000], 12: [100, 500], 13: [100, 500], 14: [50, 250] },
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: 'contours',
    overzoom: 1,
  })
  return contourUrl
}

export type Basemap = 'map' | 'satellite'

/**
 * Imagery, with the same relief and contours over it.
 *
 * No `recolor`: there is nothing to hold back, since photography of a mountain is
 * already the terrain rather than a drawing of it. The contours matter more here than
 * on the vector map — imagery shows what the ground is covered in and nothing at all
 * about how steep it is.
 */
async function satelliteStyle(): Promise<StyleSpecification> {
  return (await satellite({
    baseUrl: TILES,
    tiles: [SATELLITE],
    hillshade: HILLSHADE,
    language: 'en',
  })) as StyleSpecification
}

export async function basemapStyle(kind: Basemap = 'map'): Promise<StyleSpecification> {
  if (kind === 'satellite') return withContours(await satelliteStyle())
  return withContours(await vectorStyle())
}

async function vectorStyle(): Promise<StyleSpecification> {
  const style = await colorful({
    baseUrl: TILES,
    hillshade: HILLSHADE,
    // Barely held back. An earlier pass desaturated this by a third to keep the
    // tracks dominant, and took the terrain down with it — woodland, scrub and rock
    // are most of what a map of the Alps has to say. A slight wash towards the paper
    // the app is drawn on is enough to seat it under the lines.
    recolor: { saturate: -0.05, gamma: 1.02, blend: 0.06, blendColor: '#eef1ee' },
    language: 'en',
  })

  return style as StyleSpecification
}

/** Contours are generated from the DEM, so they belong to whatever is underneath. */
function withContours(style: StyleSpecification): StyleSpecification {
  style.sources[CONTOUR_SOURCE] = {
    type: 'vector',
    tiles: [contourTiles()],
    maxzoom: 15,
  }

  style.layers.push(
    {
      id: 'contour-lines',
      type: 'line',
      source: CONTOUR_SOURCE,
      'source-layer': 'contours',
      minzoom: CONTOUR_MIN_ZOOM,
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
  )

  return style as StyleSpecification
}

export const BASEMAP = { TILES, ELEVATION, CONTOUR_MIN_ZOOM }
