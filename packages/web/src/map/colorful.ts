import { colorful } from '@versatiles/style'

/**
 * The vector basemap's style decisions, apart from the MapLibre wiring in `basemap.ts`.
 *
 * Kept free of `maplibre-gl` so the phone can be handed the very same style: `pnpm style:app`
 * runs this in Node and writes what it returns into the app, which draws it with MapLibre
 * Native. A change here reaches both, and `app-style.test.ts` fails until the app's copy is
 * regenerated.
 */

export const TILES = 'https://tiles.versatiles.org'

/**
 * VersaTiles' own hillshade, tuned down.
 *
 * Relief has to stay under everything: a warm highlight and a cool shadow at low
 * exaggeration reads as terrain without competing with the landcover beneath it or
 * with a line drawn on top.
 */
export const HILLSHADE = {
  shadowColor: '#4a5a63',
  highlightColor: '#fffaf0',
  accentColor: '#8a9691',
  exaggeration: 0.35,
  illuminationDirection: 315,
} as const

export function washedColorful() {
  return colorful({
    baseUrl: TILES,
    hillshade: HILLSHADE,
    // Barely held back. An earlier pass desaturated this by a third to keep the
    // tracks dominant, and took the terrain down with it — woodland, scrub and rock
    // are most of what a map of the Alps has to say. A slight wash towards the paper
    // the app is drawn on is enough to seat it under the lines.
    recolor: { saturate: -0.05, gamma: 1.02, blend: 0.06, blendColor: '#eef1ee' },
    language: 'en',
  })
}
