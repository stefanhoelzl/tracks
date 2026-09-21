/**
 * Mapbox Vector Tiles, for points only, written by hand.
 *
 * A tile here is one layer of points with three properties, and the whole encoding of that is a few
 * protobuf fields — smaller than any library's API for it, and it keeps the bytes this file's. Tiles
 * must come out byte-identical for identical input, because the upload skips every tile whose hash
 * has not changed: the points are sorted before encoding, the value table is built in that order,
 * and nothing time- or order-dependent is written.
 *
 * Read back by `@mapbox/vector-tile` in the tests — the decoder MapLibre itself uses.
 */

/** A point positioned in tile units, 0…extent from the tile's north-west corner. */
export type TilePoint = {
  readonly x: number
  readonly y: number
  readonly kind: string
  readonly name?: string
  readonly ele?: number
}

class Writer {
  private bytes = new Uint8Array(256)
  length = 0

  private room(n: number) {
    if (this.length + n <= this.bytes.length) return
    let size = this.bytes.length * 2
    while (size < this.length + n) size *= 2
    const grown = new Uint8Array(size)
    grown.set(this.bytes.subarray(0, this.length))
    this.bytes = grown
  }

  varint(value: number) {
    this.room(5)
    let v = value >>> 0
    while (v >= 0x80) {
      this.bytes[this.length++] = (v & 0x7f) | 0x80
      v >>>= 7
    }
    this.bytes[this.length++] = v
  }

  sint(value: number) {
    this.varint((value << 1) ^ (value >> 31))
  }

  raw(data: Uint8Array) {
    this.room(data.length)
    this.bytes.set(data, this.length)
    this.length += data.length
  }

  /** A length-delimited field: key, length, then the bytes. */
  message(field: number, data: Uint8Array) {
    this.varint((field << 3) | 2)
    this.varint(data.length)
    this.raw(data)
  }

  /** A varint field. */
  field(field: number, value: number) {
    this.varint((field << 3) | 0)
    this.varint(value)
  }

  done(): Uint8Array {
    return this.bytes.slice(0, this.length)
  }
}

const utf8 = new TextEncoder()

// Field numbers from vector_tile.proto.
const TILE_LAYERS = 3
const LAYER_NAME = 1
const LAYER_FEATURES = 2
const LAYER_KEYS = 3
const LAYER_VALUES = 4
const LAYER_EXTENT = 5
const LAYER_VERSION = 15
const FEATURE_TAGS = 2
const FEATURE_TYPE = 3
const FEATURE_GEOMETRY = 4
const VALUE_STRING = 1
const VALUE_SINT = 6
const GEOM_POINT = 1
/** MoveTo, once: `(1 & 0x7) | (1 << 3)`. */
const MOVE_TO_ONE = 9

const KEYS = ['kind', 'name', 'ele'] as const
const KIND = 0
const NAME = 1
const ELE = 2

function order(a: TilePoint, b: TilePoint): number {
  return (
    a.y - b.y ||
    a.x - b.x ||
    (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) ||
    ((a.name ?? '') < (b.name ?? '') ? -1 : (a.name ?? '') > (b.name ?? '') ? 1 : 0) ||
    (a.ele ?? 0) - (b.ele ?? 0)
  )
}

/** One tile, uncompressed: a single layer named `layer` holding `points`. */
export function encodeTile(
  layer: string,
  points: readonly TilePoint[],
  extent: number,
): Uint8Array {
  const values: Uint8Array[] = []
  const index = new Map<string, number>()
  const value = (key: string, encode: () => Uint8Array) => {
    let at = index.get(key)
    if (at === undefined) {
      at = values.length
      index.set(key, at)
      values.push(encode())
    }
    return at
  }
  const text = (s: string) =>
    value(`s${s}`, () => {
      const w = new Writer()
      w.message(VALUE_STRING, utf8.encode(s))
      return w.done()
    })
  const int = (n: number) =>
    value(`i${n}`, () => {
      const w = new Writer()
      w.varint((VALUE_SINT << 3) | 0)
      w.sint(n)
      return w.done()
    })

  const body = new Writer()
  for (const point of [...points].sort(order)) {
    const tags = new Writer()
    tags.varint(KIND)
    tags.varint(text(point.kind))
    if (point.name !== undefined) {
      tags.varint(NAME)
      tags.varint(text(point.name))
    }
    if (point.ele !== undefined) {
      tags.varint(ELE)
      tags.varint(int(point.ele))
    }
    // Every feature's geometry starts from (0,0), so a point is written where it is, not
    // relative to the one before it.
    const geometry = new Writer()
    geometry.varint(MOVE_TO_ONE)
    geometry.sint(point.x)
    geometry.sint(point.y)

    const feature = new Writer()
    feature.message(FEATURE_TAGS, tags.done())
    feature.field(FEATURE_TYPE, GEOM_POINT)
    feature.message(FEATURE_GEOMETRY, geometry.done())
    body.message(LAYER_FEATURES, feature.done())
  }

  const out = new Writer()
  out.message(LAYER_NAME, utf8.encode(layer))
  out.raw(body.done())
  for (const key of KEYS) out.message(LAYER_KEYS, utf8.encode(key))
  for (const v of values) out.message(LAYER_VALUES, v)
  out.field(LAYER_EXTENT, extent)
  out.field(LAYER_VERSION, 2)

  const tile = new Writer()
  tile.message(TILE_LAYERS, out.done())
  return tile.done()
}
