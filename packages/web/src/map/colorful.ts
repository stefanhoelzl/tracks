import { osm, type TileJSONSpecification } from '@versatiles/style'
import { POINT_SOURCES, POINTS_LAYER, type PointKind, tilesUrl } from './points.ts'

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
 * The two tilesets, spelled out rather than asked of their `tiles.json`: that would be a request
 * before the first tile, and the TileJSON's own tile URLs are relative, which MapLibre cannot
 * resolve. The zoom ranges are what overzoom the last level, and the attributions are what the map
 * credits.
 */
export const OSM_TILES: TileJSONSpecification = {
  tilejson: '3.0.0',
  tiles: [`${TILES}/tiles/osm/{z}/{x}/{y}`],
  minzoom: 0,
  maxzoom: 14,
  bounds: [-180, -85.0511287798066, 180, 85.0511287798066],
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}

/** Terrarium-encoded, 512 px, z0–12. The same source feeds hillshade and contours. */
export const ELEVATION_TILES: TileJSONSpecification = {
  tilejson: '3.0.0',
  tiles: [`${TILES}/tiles/elevation/{z}/{x}/{y}`],
  minzoom: 0,
  maxzoom: 12,
  bounds: [-180, -85.051129, 180, 85.051129],
  attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
}

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
} as const

/**
 * Light from the north-west, the way a relief map is lit, so a valley reads as a valley rather
 * than as a ridge. v6 has no option for the hillshade's direction, so it is set on the layer.
 */
export const LIGHT = { direction: 315, altitude: 45 } as const

/**
 * What v6 changed and this map keeps as it was: a flat map, where v6 defaults to a globe at the
 * world zooms, and no sky, which MapLibre would draw over a pitched or globe view.
 */
const AS_BEFORE = {
  projection: 'mercator',
  sky: false,
  sun: { direction: LIGHT.direction, altitude: LIGHT.altitude, anchor: 'map' },
} as const

export function washedColorful() {
  const style = osm({
    theme: 'colorful',
    urls: { base: TILES, osm: OSM_TILES, elevation: ELEVATION_TILES, sprite: SPRITES },
    features: { hillshade: HILLSHADE },
    // Barely held back. An earlier pass desaturated this by a third to keep the
    // tracks dominant, and took the terrain down with it — woodland, scrub and rock
    // are most of what a map of the Alps has to say. A slight wash towards the paper
    // the app is drawn on is enough to seat it under the lines.
    recolor: { saturate: -0.05, gamma: 1.02, blend: { amount: 0.06, color: '#eef1ee' } },
    text: { language: 'en' },
    ...AS_BEFORE,
  })
  const layers = withPlaceLabels(
    withPoints(withWaterLabels(withWayNetworks(withLight(style.layers)))),
  )
  return { ...style, sources: { ...style.sources, ...pointSources() }, layers }
}

/** The hillshade lit from `LIGHT`, which v6 cannot be told. */
export function withLight<L extends { type: string; paint?: object }>(layers: L[]): L[] {
  return layers.map((layer) =>
    layer.type === 'hillshade'
      ? {
          ...layer,
          paint: {
            ...layer.paint,
            'hillshade-illumination-direction': LIGHT.direction,
            'hillshade-illumination-altitude': LIGHT.altitude,
          },
        }
      : layer,
  )
}

/**
 * Water names, which VersaTiles draws from v6 on — rivers and canals from z12, streams and ditches
 * from z14, lakes by size — in its own pale blue.
 *
 * Here in the water's own blue, darkened until it holds against the paper: there is no italic in
 * the glyphs VersaTiles serves, so colour is what separates a water name from a street name. Set
 * after the recolour rather than as a palette colour, so the wash does not move it.
 */
export const WATER_LABEL_COLOUR = '#2f6fa8'

/**
 * How often a river's name repeats along it, in px: tighter than MapLibre's 250, so a name is
 * always within a phone screen of wherever you are looking.
 */
export const WATER_LABEL_SPACING = 160

function withWaterLabels<L extends { id: string; paint?: object; layout?: object }>(
  layers: L[],
): L[] {
  return layers.map((layer) => {
    if (!layer.id.startsWith('label-water-')) return layer
    const layout = layer.layout as { 'symbol-placement'?: string } | undefined
    return {
      ...layer,
      ...(layout?.['symbol-placement'] === 'line'
        ? { layout: { ...layout, 'symbol-spacing': WATER_LABEL_SPACING } }
        : {}),
      paint: { ...layer.paint, 'text-color': WATER_LABEL_COLOUR },
    }
  })
}

type Layer = ReturnType<typeof osm>['layers'][number]
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

/** Streets signed for bikes that VersaTiles has no bike layer for. */
const UNMARKED_BIKE_STREETS = ['track', 'service']
const DESIGNATED: unknown[] = ['==', ['get', 'bicycle'], 'designated']
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
      if (layer.id === `${structure}street-minor-bicycle`) {
        // v6 draws designated minor streets and pedestrian zones, and no longer tracks and service
        // roads — which is where a signed bike route leaves the tarmac. So those two are ours.
        for (const kind of UNMARKED_BIKE_STREETS) {
          const match = [['==', ['get', 'kind'], kind], DESIGNATED, ...onStructure(structure)]
          out.push(
            ...network(layer, `${structure}street-${kind}-bicycle`, structure, match, BIKE_COLOUR),
          )
        }
      }
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
 * Place names from the zoom their data starts at, rather than from the zoom VersaTiles chose.
 *
 * Measured against the tiles: `place_labels` carries village and hamlet from z10 — the style held
 * hamlet to z13, so a 20 km view of a valley named almost nothing in it.
 *
 * `locality`, OSM's named nowhere, was drawn here too while it was the closest thing to a peak
 * name in a schema without peaks. The map has its own peaks now (`withPoints`), and it is not.
 */
export const PLACE_MINZOOM = { town: 8, village: 10, hamlet: 11 } as const

function withPlaceLabels(layers: Layer[]): Layer[] {
  return layers.map((layer) => {
    const kind = /^label-place-(town|village|hamlet)$/.exec(layer.id)?.[1]
    if (!kind) return layer
    return { ...layer, minzoom: PLACE_MINZOOM[kind as keyof typeof PLACE_MINZOOM] }
  })
}

/**
 * The map's own points (`points.ts`): water a ride can drink, summits, and the places a ride stops
 * at, from `tracks-outdoor`, at the zooms a ride is planned at.
 *
 * Shortbread has no peaks, saddles, passes or springs at any zoom, and draws the rest only from
 * z14, so a 40 km view of a valley said nothing about where to fill a bottle, what the mountains
 * were called or where the huts were. The tiles start at z9.
 *
 * Water is the water's own blue: a dot from z10, where a 20 km view can hold a hundred and more, the
 * drop from z13, the name from z16 — few fountains have one. A summit is a fact about the terrain
 * and is drawn in the contours' ink, as a glyph: a peak as ▲ with its name and height, a pass or a
 * saddle as )(. A pass is what a route crosses, so it comes first, from z10; peaks and saddles from
 * z11, a peak with no name only from z13, and where two collide the higher is drawn.
 *
 * The stops are icons in four inks, one per reason to stop, each from the zoom its reason starts
 * mattering at: a hut is a day's destination (z11), a camp site a night's (z12), a shelter, a toilet
 * or a bike shop is on the way (z13), a viewpoint or a picnic table is a pause (z14). Their names
 * follow two zooms later. Waterfalls, caves, fords and repair stands are in the tiles and not drawn:
 * no icon says them yet.
 *
 * Whatever is drawn from here is taken off Shortbread's own POI layers, so nothing is drawn twice —
 * and Shortbread's wells and taps go with it, drinkable or not, since only drinkable water is drawn.
 */
export const WATER_POINT_COLOUR = WATER_LABEL_COLOUR
export const SUMMIT_COLOUR = 'rgb(58,72,66)'

/** Every water kind `points.ts` carries is drinkable: the extract takes nothing else. */
export const WATER_KINDS = [
  'drinking_water',
  'water_tap',
  'water_point',
  'water_well',
  'spring',
] as const satisfies readonly PointKind[]

export const WATER_ZOOMS = { dot: 10, icon: 13, name: 16 } as const
export const SUMMIT_ZOOMS = { pass: 10, summit: 11, unnamedPeak: 13 } as const

/** A reason to stop: the kinds it covers, each with its icon, the zoom it starts at and its ink. */
export type StopGroup = {
  readonly id: string
  readonly minzoom: number
  readonly colour: string
  readonly icons: Readonly<Partial<Record<PointKind, string>>>
}

export const STOP_GROUPS = [
  {
    id: 'point-hut',
    minzoom: 11,
    colour: '#8a5a3c',
    icons: { alpine_hut: 'base:icon-lodging', wilderness_hut: 'icons:house' },
  },
  {
    id: 'point-camp',
    minzoom: 12,
    colour: '#4f7a3a',
    icons: { camp_site: 'base:icon-campsite', caravan_site: 'base:icon-caravan' },
  },
  {
    id: 'point-service',
    minzoom: 13,
    colour: '#6e7672',
    icons: {
      shelter: 'base:icon-shelter',
      toilets: 'base:icon-restrooms',
      bicycle_shop: 'icons:bicycle',
    },
  },
  {
    id: 'point-sight',
    minzoom: 14,
    colour: '#7a5a8a',
    icons: { viewpoint: 'base:icon-viewpoint', picnic_site: 'base:icon-picnic_site' },
  },
] as const satisfies readonly StopGroup[]

/** How many zooms after its icon a stop is named. */
export const STOP_NAME_AFTER = 2

/**
 * Shortbread's copies of what is drawn here, by the tag its POI layer reads: its `poi-amenity`
 * reads `amenity`, and so on. Its water points are not listed: Shortbread draws none.
 */
export const TAKEN_FROM_SHORTBREAD = {
  'poi-amenity': ['amenity', ['drinking_water', 'shelter', 'toilets']],
  'poi-tourism': [
    'tourism',
    ['alpine_hut', 'wilderness_hut', 'camp_site', 'caravan_site', 'viewpoint', 'picnic_site'],
  ],
  'poi-man_made': ['man_made', ['water_well', 'water_tap']],
  'poi-shop': ['shop', ['bicycle']],
} as const

/**
 * The point sources the style names: only those something is drawn from. MapLibre Native's offline
 * packs download every source a style names, so `tracks-town` stays out until a layer reads it.
 */
export const DRAWN_POINT_SOURCES = ['outdoor'] as const

/** VersaTiles' `base` sheet, and its `icons` sheet for the pictograms `base` has no use for. */
export const SPRITES = [
  { id: 'base', url: `${TILES}/assets/sprites/base` },
  { id: 'icons', url: `${TILES}/assets/sprites/icons` },
]

function pointSources() {
  return Object.fromEntries(
    DRAWN_POINT_SOURCES.map((source) => {
      const { id, minzoom, maxzoom } = POINT_SOURCES[source]
      const spec = {
        type: 'vector',
        tiles: [tilesUrl(source)],
        minzoom,
        maxzoom,
        attribution: OSM_TILES.attribution,
      }
      return [id, spec]
    }),
  ) as Record<string, ReturnType<typeof osm>['sources'][string]>
}

const kindIn = (kinds: readonly string[]) => ['match', ['get', 'kind'], [...kinds], true, false]

const HALO = {
  'text-halo-color': 'rgba(254,254,254,0.8)',
  'text-halo-width': 2,
  'text-halo-blur': 1,
}

const POINT = {
  type: 'symbol',
  source: POINT_SOURCES.outdoor.id,
  'source-layer': POINTS_LAYER,
} as const

/** The mark on the point, the name under it, the height under that — each only if there is one. */
function summitText(mark: string) {
  return [
    'format',
    mark,
    { 'font-scale': 1.15 },
    ['case', ['has', 'name'], ['concat', '\n', ['get', 'name']], ''],
    {},
    ['case', ['has', 'ele'], ['concat', '\n', ['to-string', ['get', 'ele']], ' m'], ''],
    { 'font-scale': 0.85 },
  ]
}

function summit(id: string, kind: PointKind, mark: string, minzoom: number, filter?: unknown) {
  return {
    ...POINT,
    id,
    minzoom,
    filter: filter ? ['all', ['==', ['get', 'kind'], kind], filter] : ['==', ['get', 'kind'], kind],
    layout: {
      'text-field': summitText(mark),
      'text-font': ['noto_sans_regular'],
      'text-size': 11,
      // The text box hangs from the point, lifted so the mark rather than its top sits on it.
      'text-anchor': 'top',
      'text-offset': [0, -0.6],
      'text-line-height': 1.15,
      // Lower keys are placed first: where two summits collide, the higher one is drawn.
      'symbol-sort-key': ['-', ['coalesce', ['get', 'ele'], 0]],
    },
    paint: { 'text-color': SUMMIT_COLOUR, ...HALO },
  }
}

function stop(group: StopGroup) {
  const kinds = Object.keys(group.icons)
  return {
    ...POINT,
    id: group.id,
    minzoom: group.minzoom,
    filter: kindIn(kinds),
    layout: {
      'icon-image': ['match', ['get', 'kind'], ...Object.entries(group.icons).flat(), ''],
      'icon-size': ['interpolate', ['linear'], ['zoom'], group.minzoom, 0.5, 16, 0.65],
      'text-field': [
        'step',
        ['zoom'],
        '',
        group.minzoom + STOP_NAME_AFTER,
        ['coalesce', ['get', 'name'], ''],
      ],
      'text-font': ['noto_sans_regular'],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.9],
      'text-optional': true,
    },
    paint: { 'icon-color': group.colour, 'text-color': group.colour, ...HALO },
  }
}

export const POINT_LAYERS = [
  'point-water-dot',
  'point-water',
  ...STOP_GROUPS.map((group) => group.id),
  'point-saddle',
  'point-pass',
  'point-peak-unnamed',
  'point-peak',
] as const

function withPoints(layers: Layer[]): Layer[] {
  const points = [
    {
      id: 'point-water-dot',
      type: 'circle',
      source: POINT.source,
      'source-layer': POINTS_LAYER,
      minzoom: WATER_ZOOMS.dot,
      maxzoom: WATER_ZOOMS.icon,
      filter: kindIn(WATER_KINDS),
      paint: {
        'circle-color': WATER_POINT_COLOUR,
        'circle-radius': [
          'interpolate',
          ['linear'],
          ['zoom'],
          WATER_ZOOMS.dot,
          1.8,
          WATER_ZOOMS.icon,
          2.8,
        ],
        'circle-stroke-color': 'rgba(254,254,254,0.9)',
        'circle-stroke-width': 0.8,
      },
    },
    {
      ...POINT,
      id: 'point-water',
      minzoom: WATER_ZOOMS.icon,
      filter: kindIn(WATER_KINDS),
      layout: {
        'icon-image': 'base:icon-drinking_water',
        'icon-size': ['interpolate', ['linear'], ['zoom'], WATER_ZOOMS.icon, 0.45, 16, 0.6],
        'text-field': ['step', ['zoom'], '', WATER_ZOOMS.name, ['coalesce', ['get', 'name'], '']],
        'text-font': ['noto_sans_regular'],
        'text-size': 11,
        'text-anchor': 'top',
        'text-offset': [0, 0.9],
        'text-optional': true,
      },
      paint: { 'icon-color': WATER_POINT_COLOUR, 'text-color': WATER_POINT_COLOUR, ...HALO },
    },
    ...STOP_GROUPS.map(stop),
    summit('point-saddle', 'saddle', ')(', SUMMIT_ZOOMS.summit),
    summit('point-pass', 'pass', ')(', SUMMIT_ZOOMS.pass),
    summit('point-peak-unnamed', 'peak', '▲', SUMMIT_ZOOMS.unnamedPeak, ['!', ['has', 'name']]),
    summit('point-peak', 'peak', '▲', SUMMIT_ZOOMS.summit, ['has', 'name']),
  ] as unknown as Layer[]

  const out = layers.map((layer) => {
    const taken = TAKEN_FROM_SHORTBREAD[layer.id as keyof typeof TAKEN_FROM_SHORTBREAD]
    if (!taken) return layer
    const [key, values] = taken
    const filter = (layer as { filter?: unknown }).filter
    const notOurs = ['!', ['match', ['get', key], [...values], true, false]]
    return { ...layer, filter: filter ? ['all', filter, notOurs] : notOurs } as Layer
  })

  // Over the water names and under the place names: a village wins over a peak, a peak over a stream.
  const at = out.findIndex((layer) => layer.id.startsWith('label-place-'))
  if (at < 0) return [...out, ...points]
  return [...out.slice(0, at), ...points, ...out.slice(at)]
}
