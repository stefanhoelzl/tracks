import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import {
  BIKE_COLOUR,
  DRAWN_POINT_SOURCES,
  HIKING_COLOUR,
  LIGHT,
  POINT_LAYERS,
  SORTED_FROM,
  STOP_GROUPS,
  STOP_NAME_AFTER,
  SUMMIT_ZOOMS,
  TAKEN_FROM_SHORTBREAD,
  UNSORTED_PATH_COLOUR,
  WATER_KINDS,
  WATER_LABEL_COLOUR,
  WATER_LABEL_SPACING,
  WATER_ZOOMS,
  WAY_NETWORK,
  washedColorful,
} from './colorful.ts'
import { kindsOf, POINT_SOURCES, POINTS_LAYER, type PointSource, tilesUrl } from './points.ts'

type LineLayer = Extract<LayerSpecification, { type: 'line' }>

const style = washedColorful() as StyleSpecification
const ids = style.layers.map((l) => l.id)

const layer = (id: string) => {
  const found = style.layers.find((l) => l.id === id)
  if (!found) throw new Error(`no layer ${id}`)
  return found as LineLayer
}

/** Whether a way with these properties, at z16, is drawn by the layer. */
function draws(id: string, properties: Record<string, unknown>): boolean {
  const filter = featureFilter(layer(id).filter as FilterSpecification, `${id}.filter`)
  return filter.filter({ zoom: 16 }, { type: 2, properties } as never)
}

describe('the way networks on the basemap', () => {
  it('is still a valid style', () => {
    expect(validateStyleMin(style)).toEqual([])
  })

  it('draws cycleways and designated paths from z13, in a pale accent green', () => {
    // A VersaTiles upgrade that renames `way-cycleway` fails here, not silently on the map.
    for (const id of ['tunnel-way-bicycle', 'way-bicycle', 'bridge-way-bicycle']) {
      expect(layer(id).minzoom).toBe(WAY_NETWORK.minzoom)
      expect(layer(id).paint?.['line-color']).toBe(BIKE_COLOUR)
    }
    expect(draws('way-bicycle', { kind: 'cycleway' })).toBe(true)
    expect(draws('way-bicycle', { kind: 'path', bicycle: 'designated' })).toBe(true)
    expect(draws('way-bicycle', { kind: 'footway', bicycle: 'designated' })).toBe(true)
    expect(draws('way-bicycle', { kind: 'path' })).toBe(false)
    expect(draws('way-bicycle', { kind: 'cycleway', bridge: true })).toBe(false)
    expect(draws('bridge-way-bicycle', { kind: 'cycleway', bridge: true })).toBe(true)
  })

  it('draws trails from z13, grey until z14 tells them from bike paths, then Alpine red', () => {
    // At z13 the tiles have no `bicycle`: red there turned a shared cycle path green one zoom in.
    const colour = ['step', ['zoom'], UNSORTED_PATH_COLOUR, SORTED_FROM, HIKING_COLOUR]
    for (const id of ['tunnel-way-hiking', 'way-hiking', 'bridge-way-hiking']) {
      expect(layer(id).minzoom).toBe(WAY_NETWORK.minzoom)
      expect(layer(id).paint?.['line-color']).toEqual(colour)
      expect(layer(`${id}:unpaved`).paint?.['line-color']).toEqual(colour)
    }
    expect(draws('way-hiking', { kind: 'path' })).toBe(true)
    expect(draws('way-hiking', { kind: 'steps' })).toBe(true)
    expect(draws('way-hiking', { kind: 'footway' })).toBe(false)
    expect(draws('way-hiking', { kind: 'footway', surface: 'paved' })).toBe(false)
    expect(draws('way-hiking:unpaved', { kind: 'footway', surface: 'unpaved' })).toBe(true)
    expect(draws('way-hiking', { kind: 'path', bicycle: 'designated' })).toBe(false)
    expect(draws('way-hiking', { kind: 'cycleway' })).toBe(false)
  })

  it('dots what is unpaved, and draws what is untagged as paved', () => {
    for (const id of ['way-hiking', 'way-bicycle', 'street-track-bicycle']) {
      expect(layer(id).paint?.['line-dasharray']).toBeUndefined()
      expect(layer(`${id}:unpaved`).paint?.['line-dasharray']).toEqual(WAY_NETWORK.dots)
      expect(layer(`${id}:unpaved`).layout?.['line-cap']).toBe('round')
    }
    expect(draws('way-bicycle', { kind: 'cycleway', surface: 'unpaved' })).toBe(false)
    expect(draws('way-bicycle:unpaved', { kind: 'cycleway', surface: 'unpaved' })).toBe(true)
    expect(draws('way-hiking', { kind: 'path', surface: 'paved' })).toBe(true)
    expect(draws('way-hiking:unpaved', { kind: 'path' })).toBe(false)
    const designatedTrack = { kind: 'track', bicycle: 'designated', surface: 'unpaved' }
    expect(draws('street-track-bicycle', designatedTrack)).toBe(false)
    expect(draws('street-track-bicycle:unpaved', designatedTrack)).toBe(true)
  })

  it('never dashes, a dash being the plan’s straight line', () => {
    const lines = style.layers.filter((l) => /bicycle|hiking/.test(l.id)) as LineLayer[]
    for (const line of lines) {
      const dash = line.paint?.['line-dasharray']
      if (dash) expect(dash).toEqual(WAY_NETWORK.dots)
    }
  })

  it('draws a bike line above a trail, each right after the way it marks', () => {
    expect(ids.indexOf('way-hiking')).toBe(ids.indexOf('way-path') + 1)
    expect(ids.indexOf('way-bicycle')).toBe(ids.indexOf('way-cycleway') + 1)
    expect(ids.indexOf('way-bicycle')).toBeGreaterThan(ids.indexOf('way-hiking:unpaved'))
  })

  it('marks designated streets with the bike line, not a fill', () => {
    const streets = style.layers.filter((l) => /street-.+-bicycle$/.test(l.id)) as LineLayer[]
    expect(streets.length).toBeGreaterThan(0)
    for (const street of streets) {
      expect(street.paint?.['line-color']).toBe(BIKE_COLOUR)
      expect(street.paint?.['line-width']).toEqual(WAY_NETWORK.width)
    }
  })

  it('holds a tunnel back instead of dashing it', () => {
    expect(layer('tunnel-way-bicycle').paint?.['line-opacity']).toBe(WAY_NETWORK.tunnelOpacity)
    expect(layer('tunnel-way-hiking:unpaved').paint?.['line-opacity']).toBe(
      WAY_NETWORK.tunnelOpacity,
    )
  })
})

describe('the basemap on @versatiles/style 6', () => {
  it('asks for the sprite sheets VersaTiles still publishes, and icons only from them', () => {
    // v5's `basics` sheet was taken down with v6's release, and every POI icon went with it.
    expect(style.sprite).toEqual([
      { id: 'base', url: 'https://tiles.versatiles.org/assets/sprites/base' },
      { id: 'icons', url: 'https://tiles.versatiles.org/assets/sprites/icons' },
    ])
    const images = style.layers.map((l) =>
      JSON.stringify((l.layout as { 'icon-image'?: unknown } | undefined)?.['icon-image'] ?? ''),
    )
    const icons = images.join().match(/"\w+:[\w-]+"/g) ?? []
    const sheets = new Set(icons.map((icon) => icon.slice(1).split(':')[0]))
    expect([...sheets].sort()).toEqual(['base', 'icons'])
  })

  it('stays the flat, skyless map it was before v6', () => {
    expect(style.projection).toEqual({ type: 'mercator' })
    expect(style.sky).toBeUndefined()
  })

  it('lights the relief from the north-west', () => {
    const hillshade = style.layers.find((l) => l.type === 'hillshade')
    expect(hillshade?.paint).toMatchObject({
      'hillshade-illumination-direction': LIGHT.direction,
      'hillshade-illumination-altitude': LIGHT.altitude,
    })
  })

  it('names water in the water label blue', () => {
    for (const id of ids.filter((id) => id.startsWith('label-water-'))) {
      const label = style.layers.find((l) => l.id === id) as Extract<
        LayerSpecification,
        { type: 'symbol' }
      >
      expect(label.paint?.['text-color']).toBe(WATER_LABEL_COLOUR)
    }
  })

  it('repeats a river’s name often enough to find it on a phone', () => {
    for (const id of ['label-water-river', 'label-water-stream']) {
      const label = style.layers.find((l) => l.id === id) as Extract<
        LayerSpecification,
        { type: 'symbol' }
      >
      expect(label.layout?.['symbol-spacing']).toBe(WATER_LABEL_SPACING)
    }
  })

  it('names every tile source it draws from, with no TileJSON left to fetch', () => {
    for (const source of Object.values(style.sources)) {
      expect(source).not.toHaveProperty('url')
      expect((source as { tiles: string[] }).tiles[0]).toMatch(/^https:\/\//)
    }
  })
})

/** Whether a point with these properties, at `zoom`, is drawn by the layer — its filter and its zoom range. */
function drawsPoint(id: string, properties: Record<string, unknown>, zoom: number): boolean {
  const found = layer(id) as LayerSpecification & { minzoom?: number; maxzoom?: number }
  if (zoom < (found.minzoom ?? 0) || zoom >= (found.maxzoom ?? 24)) return false
  const filter = featureFilter(
    (found as { filter?: unknown }).filter as FilterSpecification,
    `${id}.filter`,
  )
  return filter.filter({ zoom }, { type: 1, properties } as never)
}

/** Every string a filter compares `kind` against: the kinds it can ever select. */
function kindsNamed(filter: unknown): string[] {
  if (!Array.isArray(filter)) return []
  const isKind = (e: unknown) => Array.isArray(e) && e[0] === 'get' && e[1] === 'kind'
  if (filter[0] === '==' && isKind(filter[1])) return [String(filter[2])]
  if (filter[0] === 'match' && isKind(filter[1])) {
    return filter
      .slice(2, -1)
      .filter((_, i) => i % 2 === 0)
      .flat()
      .map(String)
  }
  return filter.flatMap(kindsNamed)
}

type Symbol = { layout: Record<string, unknown>; paint: Record<string, unknown> }

describe('water, summits and stops, from the map’s own tiles', () => {
  const pointLayers = () =>
    style.layers.filter((l) => (POINT_LAYERS as readonly string[]).includes(l.id))

  it('names only the point sources something is drawn from, at the zooms they are stored at', () => {
    for (const source of Object.keys(POINT_SOURCES) as PointSource[]) {
      const { id, minzoom, maxzoom } = POINT_SOURCES[source]
      const named = style.sources[id]
      if (!(DRAWN_POINT_SOURCES as readonly string[]).includes(source)) {
        // An unread source would still fill every offline pack on the phone.
        expect(named).toBeUndefined()
        continue
      }
      expect(named).toMatchObject({ type: 'vector', tiles: [tilesUrl(source)], minzoom, maxzoom })
    }
  })

  it('filters only on kinds the extract writes into the source it reads', () => {
    // The contract `points.ts` declares: a kind renamed or dropped there fails here, not on a map
    // quietly drawing nothing.
    const sourceById = Object.fromEntries(
      Object.entries(POINT_SOURCES).map(([key, { id }]) => [id, key as PointSource]),
    )
    expect(pointLayers()).toHaveLength(POINT_LAYERS.length)
    for (const point of pointLayers() as (LayerSpecification & { source: string })[]) {
      const source = sourceById[point.source]
      expect(source, `${point.id} reads ${point.source}`).toBeDefined()
      expect((point as { 'source-layer'?: string })['source-layer']).toBe(POINTS_LAYER)
      const declared = kindsOf(source as PointSource) as string[]
      const named = kindsNamed((point as { filter?: unknown }).filter)
      expect(named.length).toBeGreaterThan(0)
      for (const kind of named) expect(declared, `${point.id} filters on ${kind}`).toContain(kind)
    }
  })

  it('draws water as a dot from z10, the drop from z13, and its name from z16', () => {
    for (const kind of WATER_KINDS) {
      expect(drawsPoint('point-water-dot', { kind }, WATER_ZOOMS.dot)).toBe(true)
      expect(drawsPoint('point-water-dot', { kind }, WATER_ZOOMS.icon)).toBe(false)
      expect(drawsPoint('point-water', { kind }, WATER_ZOOMS.icon)).toBe(true)
    }
    expect(drawsPoint('point-water-dot', { kind: 'drinking_water' }, 9)).toBe(false)
    expect(drawsPoint('point-water-dot', { kind: 'peak' }, 10)).toBe(false)
    const water = layer('point-water') as unknown as Symbol
    expect(water.layout['icon-image']).toBe('base:icon-drinking_water')
    expect(water.layout['text-field']).toEqual([
      'step',
      ['zoom'],
      '',
      WATER_ZOOMS.name,
      ['coalesce', ['get', 'name'], ''],
    ])
  })

  it('draws passes from z10, named peaks and saddles from z11, and a nameless peak from z13', () => {
    expect(drawsPoint('point-pass', { kind: 'pass' }, SUMMIT_ZOOMS.pass)).toBe(true)
    expect(drawsPoint('point-saddle', { kind: 'saddle' }, SUMMIT_ZOOMS.pass)).toBe(false)
    expect(drawsPoint('point-saddle', { kind: 'saddle' }, SUMMIT_ZOOMS.summit)).toBe(true)
    const named = { kind: 'peak', name: 'Alpspitze' }
    expect(drawsPoint('point-peak', named, SUMMIT_ZOOMS.pass)).toBe(false)
    expect(drawsPoint('point-peak', named, SUMMIT_ZOOMS.summit)).toBe(true)
    expect(drawsPoint('point-peak', { kind: 'peak' }, 16)).toBe(false)
    const unnamed = { kind: 'peak' }
    expect(drawsPoint('point-peak-unnamed', unnamed, SUMMIT_ZOOMS.unnamedPeak - 1)).toBe(false)
    expect(drawsPoint('point-peak-unnamed', unnamed, SUMMIT_ZOOMS.unnamedPeak)).toBe(true)
    expect(drawsPoint('point-peak-unnamed', named, 16)).toBe(false)
    expect(drawsPoint('point-peak', { kind: 'saddle', name: 'x' }, 11)).toBe(false)
  })

  it('draws each stop from its group’s zoom, in its icon and ink, and names it two zooms later', () => {
    for (const group of STOP_GROUPS) {
      const drawn = layer(group.id) as unknown as Symbol
      for (const [kind, icon] of Object.entries(group.icons)) {
        expect(drawsPoint(group.id, { kind }, group.minzoom - 1)).toBe(false)
        expect(drawsPoint(group.id, { kind }, group.minzoom)).toBe(true)
        const image = drawn.layout['icon-image'] as unknown[]
        expect(image[image.indexOf(kind) + 1]).toBe(icon)
      }
      expect(drawn.paint['icon-color']).toBe(group.colour)
      expect((drawn.layout['text-field'] as unknown[])[3]).toBe(group.minzoom + STOP_NAME_AFTER)
    }
  })

  it('takes Shortbread’s copies of what it draws off the map, and nothing else Shortbread draws', () => {
    const drawsPoi = (id: string, properties: Record<string, string>) =>
      featureFilter(layer(id).filter as FilterSpecification, `${id}.filter`).filter({ zoom: 17 }, {
        type: 1,
        properties,
      } as never)
    for (const [id, [key, values]] of Object.entries(TAKEN_FROM_SHORTBREAD)) {
      for (const value of values)
        expect(drawsPoi(id, { [key]: value }), `${id} ${value}`).toBe(false)
    }
    expect(drawsPoi('poi-amenity', { amenity: 'cafe' })).toBe(true)
    expect(drawsPoi('poi-tourism', { tourism: 'museum' })).toBe(true)
    expect(drawsPoi('poi-shop', { shop: 'bakery' })).toBe(true)
  })

  it('puts the points over the water names and under the place names', () => {
    const firstPlace = ids.findIndex((id) => id.startsWith('label-place-'))
    for (const id of POINT_LAYERS) {
      expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf('label-water-river'))
      expect(ids.indexOf(id)).toBeLessThan(firstPlace)
    }
  })

  it('no longer draws localities, now that peaks carry their own names', () => {
    expect(ids).not.toContain('label-place-locality')
  })
})
