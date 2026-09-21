import { gunzipSync } from 'node:zlib'
import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { describe, expect, it } from 'vitest'
import type { Point } from './features.ts'
import { tileHash, tileOf, tilesAt } from './tiles.ts'

describe('the tile a point falls in', () => {
  it('matches the slippy-map scheme MapLibre asks for', () => {
    // Marienplatz, Munich: 14/8718/5685 on any OSM tile server.
    expect(tileOf(11.5755, 48.1374, 14)).toMatchObject({ x: 8718, y: 5685 })
    expect(tileOf(11.5755, 48.1374, 11)).toMatchObject({ x: 1089, y: 710 })
    expect(tileOf(-180, 0, 9)).toMatchObject({ x: 0, y: 256 })
  })

  it('keeps the edges of the world inside it', () => {
    expect(tileOf(180, 0, 9)).toMatchObject({ x: 511 })
    expect(tileOf(0, 89.9, 9)).toMatchObject({ y: 0 })
    const { px, py } = tileOf(179.9999999, -85.05, 9)
    expect(px).toBeLessThan(32768)
    expect(py).toBeLessThan(32768)
  })
})

const peak: Point = {
  lon: 10.9863,
  lat: 47.4211,
  kind: 'peak',
  source: 'outdoor',
  name: 'Zugspitze',
  ele: 2962,
}
const water: Point = { lon: 11.5755, lat: 48.1374, kind: 'drinking_water', source: 'outdoor' }

describe('the tiles of one zoom', () => {
  const tiles = [...tilesAt([water, peak], 'outdoor', 11)]

  it('are written only where there is something, under the source’s path', () => {
    expect(tiles.map((t) => t.path)).toEqual(['outdoor/11/1086/716.pbf', 'outdoor/11/1089/710.pbf'])
  })

  it('are gzipped MVT holding the points that fall in them', () => {
    const tile = tiles.find((t) => t.path === 'outdoor/11/1086/716.pbf')
    if (!tile) throw new Error('no tile for the peak')
    const layer = new VectorTile(new PbfReader(gunzipSync(tile.body))).layers.points
    expect(layer?.length).toBe(1)
    expect(layer?.feature(0).properties).toEqual({ kind: 'peak', name: 'Zugspitze', ele: 2962 })
  })

  it('come out the same whatever order the points came in', () => {
    const again = [...tilesAt([peak, water], 'outdoor', 11)]
    expect(again.map((t) => tileHash(t.body))).toEqual(tiles.map((t) => tileHash(t.body)))
  })
})
