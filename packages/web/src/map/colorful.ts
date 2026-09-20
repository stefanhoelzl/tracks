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

export async function washedColorful() {
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
  return { ...style, layers: withPlaceLabels(withWaterLabels(withWayNetworks(style.layers))) }
}

type Layer = Awaited<ReturnType<typeof colorful>>['layers'][number]
type LineLayer = Extract<Layer, { type: 'line' }>
type LinePaint = NonNullable<LineLayer['paint']>
type Filter = NonNullable<LineLayer['filter']>

/**
 * The ways the app is for — by bike and on foot — each a thin line of its own colour over the
 * basemap, from the zoom the tiles first carry them.
 *
 * Only what Shortbread carries. A lane painted on a road is not in the tiles; nor is a trail's
 * difficulty. Paths, footways, steps and cycleways arrive at z13, `bicycle` at z14; the lines
 * start wherever the data does, and nothing further out has any to draw.
 *
 * Basemap, not data: both stay thinner than a track at every zoom, so neither reads as a ride.
 * `surface=unpaved` is dotted — never dashed, a dash being the plan's straight line — and an
 * unknown surface is drawn as paved, since most of what is untagged is. A tunnel is the same
 * line held back, rather than VersaTiles' dash.
 *
 * Drawn after the recolour, so the wash does not move them: these are the colours they are.
 */
export const WAY_NETWORK = {
  minzoom: 13,
  /** Tracks run 1.8–4.5; this stays under them wherever both are drawn. */
  width: ['interpolate', ['linear'], ['zoom'], 13, 0.8, 15, 1.4, 17, 2.2, 20, 3],
  /** Dots need more body than a line to be seen at all; still under a track. */
  dottedWidth: ['interpolate', ['linear'], ['zoom'], 13, 1.4, 15, 2, 17, 2.8, 20, 3.6],
  /** Zero-length dashes with round caps: dots, a width apart, which no dash can be mistaken for. */
  dots: [0, 2],
  tunnelOpacity: 0.5,
} satisfies {
  minzoom: number
  width: LinePaint['line-width']
  dottedWidth: LinePaint['line-width']
  dots: number[]
  tunnelOpacity: number
}

/**
 * `kind=cycleway`, and anything `bicycle=designated`, in the accent's own green washed towards
 * the paper — the app's colour for the app's kind of way. Blue was tried first and read as a
 * stream. The plan stays apart by being the full accent at 3.4.
 */
export const BIKE_COLOUR = '#72b89f'

/**
 * Trails: paths and steps, and a footway only when unpaved — a paved footway is a pavement,
 * and a town would otherwise turn red. A way signed for bikes is the bike network's.
 *
 * The red of an Alpine trail blaze, chosen over brown, terracotta and taupe side by side on
 * the map. It sits near the palette's `#b0304b`; at a hairline under a 4.5 track, and dotted
 * where most trails are, it stays basemap.
 */
export const HIKING_COLOUR = '#b5523b'

/**
 * What a trail is drawn in at z13, where the tiles do not yet say whether it is one.
 *
 * `bicycle` only arrives at z14, so at z13 a shared foot-and-cycle path is indistinguishable
 * from a trail — drawn red there, it turned green one zoom in (Bordeauxplatz, Munich). A quiet
 * grey commits to neither: every path is visible at z13, and takes its colour at z14. Not the
 * palette's neutral `#8a9691`, which is a track's *not set*.
 */
export const UNSORTED_PATH_COLOUR = '#a39e98'

/** The zoom from which the tiles carry `bicycle`, and a path can be told apart. */
export const SORTED_FROM = 14

/** Ways Shortbread has no bike layer for, but which are signed for bikes. */
const SHARED_PATHS = ['path', 'footway', 'bridleway']

const UNPAVED: unknown[] = ['==', ['get', 'surface'], 'unpaved']
const NOT_UNPAVED: unknown[] = ['!=', ['get', 'surface'], 'unpaved']

const BIKE_WAYS = [
  'any',
  ['==', ['get', 'kind'], 'cycleway'],
  [
    'all',
    // `match` rather than `in`, which MapLibre Native learnt later than GL JS did.
    ['match', ['get', 'kind'], SHARED_PATHS, true, false],
    ['==', ['get', 'bicycle'], 'designated'],
  ],
]

const HIKING_WAYS = [
  'all',
  ['!=', ['get', 'bicycle'], 'designated'],
  [
    'any',
    ['match', ['get', 'kind'], ['path', 'steps'], true, false],
    ['all', ['==', ['get', 'kind'], 'footway'], UNPAVED],
  ],
]

/**
 * VersaTiles draws designated streets as a pale fill over the street; that fill becomes the
 * line down its middle. Paths and cycleways keep their own pale ways at z15+, and get lines
 * on top from z13: trails after `way-path`, then the bike network after `way-cycleway`, so a
 * bike line is never under a trail.
 */
function withWayNetworks(layers: Layer[]): Layer[] {
  const out: Layer[] = []
  for (const layer of layers) {
    const structure = /^(tunnel-|bridge-)?/.exec(layer.id)?.[1] ?? ''
    if (layer.type !== 'line') {
      out.push(layer)
      continue
    }
    if (/^(tunnel-|bridge-)?street-.+-bicycle$/.test(layer.id)) {
      out.push(...network(layer, layer.id, structure, [layer.filter], BIKE_COLOUR))
      continue
    }
    out.push(layer)
    if (/^(tunnel-|bridge-)?way-path$/.test(layer.id)) {
      const match = [...onStructure(structure), HIKING_WAYS]
      const colour: LinePaint['line-color'] = [
        'step',
        ['zoom'],
        UNSORTED_PATH_COLOUR,
        SORTED_FROM,
        HIKING_COLOUR,
      ]
      out.push(...network(layer, `${structure}way-hiking`, structure, match, colour))
    }
    if (/^(tunnel-|bridge-)?way-cycleway$/.test(layer.id)) {
      const match = [...onStructure(structure), BIKE_WAYS]
      out.push(...network(layer, `${structure}way-bicycle`, structure, match, BIKE_COLOUR))
    }
  }
  return out
}

/** A solid line for paved and untagged ways under `id`, and a dotted one for unpaved under `id:unpaved`. */
function network(
  base: LineLayer,
  id: string,
  structure: string,
  match: unknown[],
  colour: LinePaint['line-color'],
): LineLayer[] {
  const opacity = structure === 'tunnel-' ? WAY_NETWORK.tunnelOpacity : 1
  const line = {
    type: 'line',
    source: base.source,
    'source-layer': base['source-layer'],
    minzoom: WAY_NETWORK.minzoom,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  } as const
  return [
    {
      ...line,
      id,
      filter: all(...match, NOT_UNPAVED),
      paint: { 'line-color': colour, 'line-width': WAY_NETWORK.width, 'line-opacity': opacity },
    },
    {
      ...line,
      id: `${id}:unpaved`,
      filter: all(...match, UNPAVED),
      paint: {
        'line-color': colour,
        'line-width': WAY_NETWORK.dottedWidth,
        'line-opacity': opacity,
        'line-dasharray': WAY_NETWORK.dots,
      },
    },
  ]
}

/** The style spec's filter types cannot follow conditions assembled at runtime; the tests validate the style instead. */
function all(...conditions: unknown[]): Filter {
  return ['all', ...conditions] as Filter
}

/** Which of tunnel, bridge or neither a layer draws — the same split VersaTiles' own layers make. */
function onStructure(structure: string): unknown[] {
  if (structure === 'tunnel-') return [['==', ['get', 'tunnel'], true]]
  if (structure === 'bridge-') return [['==', ['get', 'bridge'], true]]
  return [
    ['!=', ['get', 'bridge'], true],
    ['!=', ['get', 'tunnel'], true],
  ]
}

/**
 * Water names, which `colorful` draws nowhere at all.
 *
 * Shortbread carries `water_lines_labels` — rivers and canals from z12, streams from z14 — and
 * `water_polygons_labels`, and the style has no symbol layer for either: a river on this map is
 * an anonymous blue line however far you follow it, which is exactly how it reads on a ride.
 *
 * Placed along the line and repeated every `WATER_LABEL_SPACING` px, so a name is always within
 * a phone screen of wherever you are looking. The blue is the water's own, darkened until it
 * holds against the paper; there is no italic in the glyphs VersaTiles serves, so colour is what
 * separates a water name from a street name.
 *
 * They go in under the place labels: where a village name and a stream name want the same pixels,
 * the village wins.
 */
export const WATER_LABEL_COLOUR = '#2f6fa8'
export const WATER_LABEL_SPACING = 160

function waterLabel(
  id: string,
  sourceLayer: string,
  filter: unknown,
  minzoom: number,
  size: number[][],
) {
  return {
    id,
    type: 'symbol',
    source: 'versatiles-shortbread',
    'source-layer': sourceLayer,
    minzoom,
    filter,
    layout: {
      'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name']],
      'text-font': ['noto_sans_regular'],
      'symbol-placement': sourceLayer === 'water_lines_labels' ? 'line' : 'point',
      'symbol-spacing': WATER_LABEL_SPACING,
      'text-size': { stops: size },
    },
    paint: {
      'text-color': WATER_LABEL_COLOUR,
      'text-halo-color': 'rgba(254,254,254,0.8)',
      'text-halo-width': 2,
      'text-halo-blur': 1,
    },
  }
}

function withWaterLabels(layers: Layer[]): Layer[] {
  const water = [
    waterLabel(
      'label-water-river',
      'water_lines_labels',
      ['match', ['get', 'kind'], ['river', 'canal'], true, false],
      12,
      [
        [12, 10],
        [16, 13],
      ],
    ),
    waterLabel('label-water-stream', 'water_lines_labels', ['==', ['get', 'kind'], 'stream'], 14, [
      [14, 9],
      [17, 12],
    ]),
    waterLabel('label-water-area', 'water_polygons_labels', ['has', 'name'], 11, [
      [11, 10],
      [15, 13],
    ]),
  ] as unknown as Layer[]

  // Under the place labels, which are the first `label-place-` symbol layer onwards.
  const at = layers.findIndex((layer) => layer.id.startsWith('label-place-'))
  if (at < 0) return [...layers, ...water]
  return [...layers.slice(0, at), ...water, ...layers.slice(at)]
}

/**
 * Place names from the zoom their data starts at, rather than from the zoom `colorful` chose.
 *
 * Measured against the tiles: `place_labels` carries village, hamlet, locality and
 * isolated_dwelling from z10 — the style held village to z11 and hamlet to z13, so a 20 km view
 * of a valley named almost nothing in it.
 *
 * `locality` is drawn for the first time. It is OSM's named nowhere, and in the Alps it is what
 * carries Kramer, Predigtstuhl, Kuhflucht and Stepbergeck — the closest thing to a peak name in
 * a schema that has no peaks. Quieter than a village, because it is not one.
 */
export const PLACE_MINZOOM = { town: 8, village: 10, hamlet: 11, locality: 12 } as const

function withPlaceLabels(layers: Layer[]): Layer[] {
  const out = layers.map((layer) => {
    const kind = /^label-place-(town|village|hamlet)$/.exec(layer.id)?.[1]
    if (!kind) return layer
    return { ...layer, minzoom: PLACE_MINZOOM[kind as 'town' | 'village' | 'hamlet'] }
  })

  const village = out.find((layer) => layer.id === 'label-place-village')
  if (!village) return out
  const locality = {
    ...village,
    id: 'label-place-locality',
    minzoom: PLACE_MINZOOM.locality,
    filter: ['==', ['get', 'kind'], 'locality'],
    layout: {
      ...(village as { layout?: object }).layout,
      'text-font': ['noto_sans_regular'],
      'text-size': {
        stops: [
          [12, 10],
          [15, 12],
        ],
      },
    },
    paint: {
      ...(village as { paint?: object }).paint,
      'text-color': 'rgb(110,118,114)',
    },
  } as unknown as Layer

  const at = out.findIndex((layer) => layer.id === 'label-place-village')
  return [...out.slice(0, at), locality, ...out.slice(at)]
}
