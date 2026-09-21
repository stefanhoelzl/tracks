import { satellite } from '@versatiles/style'
import mlcontour from 'maplibre-contour'
import type { StyleSpecification } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
// `?worker&url` bundles the worker *and its imports*, then hands back the URL — see below.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {
  ELEVATION_TILES,
  HILLSHADE,
  OSM_TILES,
  TILES,
  washedColorful,
  withLight,
} from './colorful.ts'
import { CONTOUR_MIN_ZOOM, CONTOUR_OVERLAYS, CONTOUR_TILES } from './contours.ts'
import { overlaysFor } from './overlay-spec.ts'

/**
 * The basemap, in one module.
 *
 * Swapping providers or dropping to a locally-served VersaTiles container is meant
 * to be a one-line change, which only stays true while every tile URL and every
 * style decision lives here — or in `colorful.ts`, which holds the vector style's
 * decisions apart from MapLibre so the phone can be given the same style.
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

/** The hillshade's own DEM, which the contours are generated from too. */
const ELEVATION = ELEVATION_TILES.tiles[0] as string

/** The same server's raster imagery, WebP. */
const SATELLITE = `${TILES}/tiles/satellite/{z}/{x}/{y}`

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
function satelliteStyle(): StyleSpecification {
  const style = satellite({
    urls: { base: TILES, satellite: SATELLITE, osm: OSM_TILES, elevation: ELEVATION_TILES },
    features: { hillshade: HILLSHADE },
    osmOverlay: { text: { language: 'en' } },
    projection: 'mercator',
    sky: false,
  })
  return { ...style, layers: withLight(style.layers) } as StyleSpecification
}

export async function basemapStyle(kind: Basemap = 'map'): Promise<StyleSpecification> {
  if (kind === 'satellite') return withContours(satelliteStyle())
  return withContours(washedColorful() as StyleSpecification)
}

/**
 * Contours are generated from the DEM, so they belong to whatever is underneath — which is why they
 * are part of the style rather than added over it, and survive nothing a basemap swap does not.
 */
function withContours(style: StyleSpecification): StyleSpecification {
  const { sources, layers } = overlaysFor(CONTOUR_OVERLAYS, 'web')
  for (const [id, source] of Object.entries(sources)) {
    style.sources[id] =
      source.type === 'vector'
        ? {
            ...source,
            tiles: source.tiles?.map((url) => (url === CONTOUR_TILES ? contourTiles() : url)),
          }
        : source
  }
  style.layers.push(...layers)
  return style
}

export const BASEMAP = { TILES, ELEVATION, CONTOUR_MIN_ZOOM }
