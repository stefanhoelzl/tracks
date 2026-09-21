/**
 * The map's own points: water, summits, and the outdoor and town places a ride is planned around.
 *
 * Shortbread's `pois` layer exists at z14 only, and has no peaks, saddles, passes, springs or taps
 * at any zoom — yet water across 20–50 km is exactly what a ride needs to see, which on a phone is
 * z9. So these are asked of QLever's copy of the planet monthly by `.github/workflows/points.yml`,
 * and cut into two tilesets on Bunny for the style to draw beside VersaTiles'.
 *
 * This file is the one declaration of what the tiles carry. The extract (`packages/scripts/points/`)
 * asks for objects by these rules and writes nothing else, and the style is to filter on these
 * kinds and no others. Once a style names these tiles the kinds are a contract with every installed
 * app — the phone carries a committed style, and the URL has no version in it — so a kind may be
 * added, and never renamed or removed.
 */

/** A custom hostname on Bunny's pull zone, so that a later move off Bunny breaks no installed app. */
export const POINTS_ORIGIN = 'https://tiles.tracks.stho.net'

/** The one source-layer every tile carries its points in. */
export const POINTS_LAYER = 'points'

/** MVT units across a tile: 0.4 m at z11, which is the basemap's own precision at z14. */
export const POINTS_EXTENT = 32768

/**
 * Two tilesets, each stored at the zooms it has something for and overzoomed above.
 *
 * `outdoor` starts at z9, 40 km across on a phone. `town` starts at z12, 5 km across — the scale at
 * which you ask where to eat — and the basemap has none of it until z14. Above `maxzoom` nothing is
 * lost: every feature is still in the tile, drawn at its z11 or z12 precision.
 */
export const POINT_SOURCES = {
  outdoor: { id: 'tracks-outdoor', path: 'outdoor', minzoom: 9, maxzoom: 11 },
  town: { id: 'tracks-town', path: 'town', minzoom: 12, maxzoom: 12 },
} as const

export type PointSource = keyof typeof POINT_SOURCES

export type PointRule = {
  readonly kind: string
  readonly source: PointSource
  /** The tag that selects an object: what the extract's query for the rule asks QLever for. */
  readonly tag: readonly [key: string, value: string]
  /** Tags the object must carry as well. */
  readonly also?: Readonly<Record<string, string>>
  /** Tag values that rule the object out. */
  readonly unless?: Readonly<Record<string, string>>
}

/**
 * In priority order: an object matching two rules is the first. A hut also tagged as a shelter is a
 * hut, a well with a drinking-water tag is drinking water, and anything outdoor wins over anything
 * in town, so an alpine hut serving food stays a hut.
 */
export const POINT_RULES = [
  // Only water a ride can drink. A fountain is drinking water by its own tag, so it is taken
  // unless it says otherwise (2k of 365k do). A tap, a water point, a well or a spring is only
  // sometimes drinkable — a cemetery's tap, a caravan's fill point — so it is taken when it says so:
  // 13k of 41k taps, 10k of 41k water points, 18k of 345k wells, 17k of 284k springs.
  {
    kind: 'drinking_water',
    source: 'outdoor',
    tag: ['amenity', 'drinking_water'],
    unless: { drinking_water: 'no' },
  },
  {
    kind: 'water_tap',
    source: 'outdoor',
    tag: ['man_made', 'water_tap'],
    also: { drinking_water: 'yes' },
  },
  {
    kind: 'water_point',
    source: 'outdoor',
    tag: ['amenity', 'water_point'],
    also: { drinking_water: 'yes' },
  },
  {
    kind: 'water_well',
    source: 'outdoor',
    tag: ['man_made', 'water_well'],
    also: { drinking_water: 'yes' },
  },
  {
    kind: 'spring',
    source: 'outdoor',
    tag: ['natural', 'spring'],
    also: { drinking_water: 'yes' },
  },
  { kind: 'peak', source: 'outdoor', tag: ['natural', 'peak'] },
  // Most road passes are tagged a saddle too; a pass is the one a route crosses, so it wins.
  { kind: 'pass', source: 'outdoor', tag: ['mountain_pass', 'yes'] },
  { kind: 'saddle', source: 'outdoor', tag: ['natural', 'saddle'] },
  { kind: 'alpine_hut', source: 'outdoor', tag: ['tourism', 'alpine_hut'] },
  { kind: 'wilderness_hut', source: 'outdoor', tag: ['tourism', 'wilderness_hut'] },
  // Most of OSM's 680k shelters are at bus stops.
  {
    kind: 'shelter',
    source: 'outdoor',
    tag: ['amenity', 'shelter'],
    unless: { shelter_type: 'public_transport' },
  },
  { kind: 'ford', source: 'outdoor', tag: ['ford', 'yes'] },
  { kind: 'toilets', source: 'outdoor', tag: ['amenity', 'toilets'] },
  { kind: 'viewpoint', source: 'outdoor', tag: ['tourism', 'viewpoint'] },
  { kind: 'picnic_site', source: 'outdoor', tag: ['tourism', 'picnic_site'] },
  { kind: 'camp_site', source: 'outdoor', tag: ['tourism', 'camp_site'] },
  { kind: 'caravan_site', source: 'outdoor', tag: ['tourism', 'caravan_site'] },
  { kind: 'waterfall', source: 'outdoor', tag: ['waterway', 'waterfall'] },
  { kind: 'cave_entrance', source: 'outdoor', tag: ['natural', 'cave_entrance'] },
  { kind: 'bicycle_shop', source: 'outdoor', tag: ['shop', 'bicycle'] },
  { kind: 'bicycle_repair', source: 'outdoor', tag: ['amenity', 'bicycle_repair_station'] },

  { kind: 'hotel', source: 'town', tag: ['tourism', 'hotel'] },
  { kind: 'guest_house', source: 'town', tag: ['tourism', 'guest_house'] },
  { kind: 'hostel', source: 'town', tag: ['tourism', 'hostel'] },
  { kind: 'station', source: 'town', tag: ['railway', 'station'] },
  { kind: 'halt', source: 'town', tag: ['railway', 'halt'] },
  { kind: 'supermarket', source: 'town', tag: ['shop', 'supermarket'] },
  { kind: 'convenience', source: 'town', tag: ['shop', 'convenience'] },
  { kind: 'bakery', source: 'town', tag: ['shop', 'bakery'] },
  { kind: 'restaurant', source: 'town', tag: ['amenity', 'restaurant'] },
  { kind: 'cafe', source: 'town', tag: ['amenity', 'cafe'] },
  { kind: 'fast_food', source: 'town', tag: ['amenity', 'fast_food'] },
  { kind: 'pub', source: 'town', tag: ['amenity', 'pub'] },
  { kind: 'fuel', source: 'town', tag: ['amenity', 'fuel'] },
  { kind: 'charging_station', source: 'town', tag: ['amenity', 'charging_station'] },
  { kind: 'attraction', source: 'town', tag: ['tourism', 'attraction'] },
  { kind: 'information', source: 'town', tag: ['tourism', 'information'] },
] as const satisfies readonly PointRule[]

export type PointKind = (typeof POINT_RULES)[number]['kind']

/** Every kind one source carries, in priority order. */
export function kindsOf(source: PointSource): PointKind[] {
  return POINT_RULES.filter((rule) => rule.source === source).map((rule) => rule.kind)
}

/** The tile URL template MapLibre is given for a source. */
export function tilesUrl(source: PointSource): string {
  return `${POINTS_ORIGIN}/${POINT_SOURCES[source].path}/{z}/{x}/{y}.pbf`
}
