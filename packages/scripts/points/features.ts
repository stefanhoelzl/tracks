/**
 * From an OSM object, as QLever returns it, to the one point the tiles carry for it.
 *
 * QLever hands over each object's geometry as WKT: a node is a POINT, a way a LINESTRING or a
 * POLYGON, a multipolygon relation a MULTIPOLYGON. Half of all alpine huts and two thirds of
 * shelters are mapped as buildings rather than nodes, so an area is not an edge case — it is reduced
 * to its centroid, which is where its icon goes.
 */
import type { PointKind, PointRule, PointSource } from '../../web/src/map/points.ts'

/** What a tile carries for one object. `ele` is whole metres; both it and `name` may be absent. */
export type Point = {
  readonly lon: number
  readonly lat: number
  readonly kind: PointKind
  readonly source: PointSource
  readonly name?: string
  readonly ele?: number
}

const FEET = 0.3048

/**
 * OSM's `ele` in whole metres, or undefined when it does not read as a height.
 *
 * It is free text: `1883`, `1883 m`, `1883,5`, `6200 ft`, `~2400`. Metres are the convention and
 * feet the one common exception; anything else — a range, a note, a second value — is dropped rather
 * than guessed at, and the feature keeps everything but its height.
 */
export function parseEle(raw: unknown): number | undefined {
  if (typeof raw !== 'string' && typeof raw !== 'number') return undefined
  const text = String(raw).trim().replace(/^~/, '')
  const found = /^(-?\d+(?:[.,]\d+)?)\s*(m|ft|feet|')?$/i.exec(text)
  if (!found?.[1]) return undefined
  const value = Number(found[1].replace(',', '.'))
  if (!Number.isFinite(value)) return undefined
  const metres = /^(ft|feet|')$/i.test(found[2] ?? '') ? value * FEET : value
  // Below the Dead Sea or above Everest is a typo, not a height.
  if (metres < -450 || metres > 8900) return undefined
  return Math.round(metres)
}

type Position = readonly number[]
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: readonly Position[] }
  | { type: 'Polygon'; coordinates: readonly (readonly Position[])[] }
  | { type: 'MultiPolygon'; coordinates: readonly (readonly (readonly Position[])[])[] }

const WKT_TYPES: Record<string, Geometry['type']> = {
  POINT: 'Point',
  LINESTRING: 'LineString',
  POLYGON: 'Polygon',
  MULTIPOLYGON: 'MultiPolygon',
}

/**
 * WKT as nested coordinate arrays — its brackets become JSON's and each `x y` a pair.
 *
 * Only the four types an OSM object comes as. Anything else, a GEOMETRYCOLLECTION from some odd
 * relation, is null here and still gets a position from `centroidOfWkt`.
 */
export function parseWkt(wkt: string): Geometry | null {
  const found = /^\s*([A-Z]+)\s*(\(.*\))\s*$/s.exec(wkt)
  const type = found?.[1] && WKT_TYPES[found[1]]
  if (!type || !found?.[2]) return null
  const json = found[2]
    .replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, '[$1,$2]')
    .replaceAll('(', '[')
    .replaceAll(')', ']')
  let nested: unknown
  try {
    nested = JSON.parse(json)
  } catch {
    return null
  }
  // POINT(x y) parses as [[x,y]]: one pair, which is its coordinates.
  const coordinates = type === 'Point' ? (nested as Position[])[0] : nested
  return { type, coordinates } as Geometry
}

/** Signed area and area-weighted centre of one ring, by the shoelace formula. */
function ring(points: readonly Position[]): { area: number; x: number; y: number } {
  let area = 0
  let x = 0
  let y = 0
  for (let i = 0; i < points.length - 1; i++) {
    const [x0 = 0, y0 = 0] = points[i] ?? []
    const [x1 = 0, y1 = 0] = points[i + 1] ?? []
    const cross = x0 * y1 - x1 * y0
    area += cross
    x += (x0 + x1) * cross
    y += (y0 + y1) * cross
  }
  return { area: area / 2, x, y }
}

function mean(points: readonly Position[]): [number, number] | null {
  if (points.length === 0) return null
  let x = 0
  let y = 0
  for (const [px = 0, py = 0] of points) {
    x += px
    y += py
  }
  return [x / points.length, y / points.length]
}

/**
 * Where an object's icon goes: a node where it is, an area at its centroid.
 *
 * The centroid is area-weighted rather than a mean of vertices, so a campsite drawn with one curved
 * edge of forty points and three straight ones is not pulled towards the curve. Only outer rings
 * count — a hole moves the centre very little and would complicate this for nothing. A ring too
 * small or too degenerate to have an area falls back to the mean of its points, as does an open way.
 */
export function centroid(geometry: Geometry): [number, number] | null {
  switch (geometry.type) {
    case 'Point': {
      const [x, y] = geometry.coordinates
      return x === undefined || y === undefined ? null : [x, y]
    }
    case 'LineString':
      return mean(geometry.coordinates)
    case 'Polygon':
    case 'MultiPolygon': {
      const outers =
        geometry.type === 'Polygon'
          ? [geometry.coordinates[0] ?? []]
          : geometry.coordinates.map((polygon) => polygon[0] ?? [])
      let area = 0
      let x = 0
      let y = 0
      for (const outer of outers) {
        const r = ring(outer)
        area += r.area
        x += r.x
        y += r.y
      }
      if (Math.abs(area) < 1e-14) return mean(outers.flat())
      return [x / (6 * area), y / (6 * area)]
    }
  }
}

/** The centroid of any WKT: parsed where it can be, otherwise the mean of every pair in it. */
export function centroidOfWkt(wkt: string): [number, number] | null {
  const geometry = parseWkt(wkt)
  if (geometry) return centroid(geometry)
  const pairs = [...wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ])
  return mean(pairs)
}

/** The point one matching object becomes under `rule`, or null for one with no place on a tile. */
export function pointOf(
  rule: PointRule & { kind: PointKind },
  wkt: string,
  name: string | undefined,
  ele: string | undefined,
): Point | null {
  const at = centroidOfWkt(wkt)
  if (!at) return null
  const [lon, lat] = at
  // Web Mercator stops at ±85.05°: past it a point has no tile to be in.
  if (!(lon >= -180 && lon <= 180 && lat > -85.05 && lat < 85.05)) return null
  const height = parseEle(ele)
  return {
    lon,
    lat,
    kind: rule.kind,
    source: rule.source,
    ...(name?.trim() ? { name: name.trim() } : {}),
    ...(height === undefined ? {} : { ele: height }),
  }
}
