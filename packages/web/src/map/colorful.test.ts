import { featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BIKE_COLOUR,
  HIKING_COLOUR,
  SORTED_FROM,
  UNSORTED_PATH_COLOUR,
  WAY_NETWORK,
  washedColorful,
} from './colorful.ts'
import { elevationTileJson } from './elevation-fixture.ts'

type LineLayer = Extract<LayerSpecification, { type: 'line' }>

// The elevation TileJSON comes from the committed fixture: this suite stays offline.
const server = setupServer(elevationTileJson)

let style: StyleSpecification
let ids: string[]

// Built here rather than at the top level, which would run before the server listens.
beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' })
  style = (await washedColorful()) as StyleSpecification
  ids = style.layers.map((l) => l.id)
})
afterAll(() => server.close())

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
