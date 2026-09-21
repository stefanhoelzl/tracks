import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { describe, expect, it } from 'vitest'
import { encodeTile, type TilePoint } from './mvt.ts'

const decode = (bytes: Uint8Array) => new VectorTile(new PbfReader(bytes))

const points: TilePoint[] = [
  { x: 30000, y: 12, kind: 'peak', name: 'Zugspitze', ele: 2962 },
  { x: 5, y: 32767, kind: 'drinking_water' },
  { x: 16384, y: 16384, kind: 'pass', name: 'Brenner', ele: 1370 },
  { x: 100, y: 200, kind: 'spring', ele: -12 },
]

describe('a tile of points, as MapLibre’s own decoder reads it', () => {
  const tile = decode(encodeTile('points', points, 32768))
  const layer = tile.layers.points
  if (!layer) throw new Error('no points layer')
  const features = Array.from({ length: layer.length }, (_, i) => layer.feature(i))

  it('is one layer, at the extent it was written at', () => {
    expect(Object.keys(tile.layers)).toEqual(['points'])
    expect(layer.extent).toBe(32768)
    expect(layer.version).toBe(2)
    expect(layer.length).toBe(points.length)
  })

  it('puts every point where it was, each from the tile’s origin', () => {
    // A cursor carried from one feature to the next would move every point after the first.
    const at = features.map((f) => {
      const [[p]] = f.loadGeometry() as unknown as [[{ x: number; y: number }]]
      return { kind: f.properties.kind, x: p.x, y: p.y, type: f.type }
    })
    for (const point of points) {
      expect(at).toContainEqual({ kind: point.kind, x: point.x, y: point.y, type: 1 })
    }
  })

  it('carries the kind always, and the name and height only when there are any', () => {
    const byKind = Object.fromEntries(features.map((f) => [f.properties.kind, f.properties]))
    expect(byKind.peak).toEqual({ kind: 'peak', name: 'Zugspitze', ele: 2962 })
    expect(byKind.drinking_water).toEqual({ kind: 'drinking_water' })
    expect(byKind.spring).toEqual({ kind: 'spring', ele: -12 })
  })
})

describe('the same points', () => {
  it('encode to the same bytes in any order, so an unchanged tile is never re-uploaded', () => {
    const forwards = encodeTile('points', points, 32768)
    const backwards = encodeTile('points', [...points].reverse(), 32768)
    expect(Buffer.from(backwards).equals(Buffer.from(forwards))).toBe(true)
  })
})
