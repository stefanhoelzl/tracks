import { describe, expect, it } from 'vitest'
import { POINT_RULES } from '../../web/src/map/points.ts'
import { centroid, centroidOfWkt, parseEle, parseWkt, pointOf } from './features.ts'

describe('a height from OSM’s free text', () => {
  it.each([
    ['1883', 1883],
    ['1883 m', 1883],
    ['1883m', 1883],
    ['1883.6', 1884],
    ['1883,4', 1883],
    ['~2400', 2400],
    ['6200 ft', 1890],
    ["6200'", 1890],
    ['-12', -12],
  ])('reads %j as %i m', (raw, metres) => {
    expect(parseEle(raw)).toBe(metres)
  })

  it.each(['', 'unknown', '1800-1900', '1883;1885', '20000', '-1000'])(
    'drops %j rather than guessing',
    (raw) => {
      expect(parseEle(raw)).toBeUndefined()
    },
  )
})

describe('where an object’s icon goes', () => {
  it('is a node where it is', () => {
    expect(centroid({ type: 'Point', coordinates: [11.5, 47.2] })).toEqual([11.5, 47.2])
  })

  it('is an area’s centroid, not the mean of its vertices', () => {
    // A 2×1 rectangle with extra vertices crowded along its east edge: the mean is pulled east,
    // the centroid stays in the middle.
    const ring = [
      [0, 0],
      [2, 0],
      [2, 0.25],
      [2, 0.5],
      [2, 0.75],
      [2, 1],
      [0, 1],
      [0, 0],
    ]
    const [x, y] = centroid({ type: 'Polygon', coordinates: [ring] }) ?? []
    expect(x).toBeCloseTo(1, 10)
    expect(y).toBeCloseTo(0.5, 10)
  })

  it('weighs the parts of a multipolygon by their areas', () => {
    const square = (x0: number, size: number) => [
      [
        [x0, 0],
        [x0 + size, 0],
        [x0 + size, size],
        [x0, size],
        [x0, 0],
      ],
    ]
    const [x] = centroid({ type: 'MultiPolygon', coordinates: [square(0, 2), square(10, 1)] }) ?? []
    // Areas 4 and 1, centres at x=1 and x=10.5.
    expect(x).toBeCloseTo((4 * 1 + 1 * 10.5) / 5, 10)
  })

  it('falls back to the mean of an open way, or of a ring with no area', () => {
    expect(
      centroid({
        type: 'LineString',
        coordinates: [
          [0, 0],
          [4, 0],
        ],
      }),
    ).toEqual([2, 0])
    expect(
      centroid({
        type: 'Polygon',
        coordinates: [
          [
            [1, 1],
            [1, 1],
            [1, 1],
          ],
        ],
      }),
    ).toEqual([1, 1])
  })
})

describe('WKT from QLever', () => {
  it('reads the four shapes an OSM object comes as', () => {
    expect(parseWkt('POINT(11.5 47.2)')).toEqual({ type: 'Point', coordinates: [11.5, 47.2] })
    expect(parseWkt('LINESTRING(0 0,4 0)')).toEqual({
      type: 'LineString',
      coordinates: [
        [0, 0],
        [4, 0],
      ],
    })
    expect(parseWkt('POLYGON((0 0,2 0,2 1,0 1,0 0))')?.type).toBe('Polygon')
    expect(parseWkt('MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5)))')?.type).toBe(
      'MultiPolygon',
    )
  })

  it('puts an area’s icon at its centroid, and anything odder at the mean of its points', () => {
    expect(centroidOfWkt('POLYGON((0 0,2 0,2 1,0 1,0 0))')).toEqual([1, 0.5])
    expect(centroidOfWkt('GEOMETRYCOLLECTION(POINT(1 1),POINT(3 3))')).toEqual([2, 2])
    expect(centroidOfWkt('POINT EMPTY')).toBeNull()
  })
})

describe('the point a tile carries', () => {
  const peak = POINT_RULES.find((rule) => rule.kind === 'peak')
  if (!peak) throw new Error('no peak rule')

  it('has the rule’s kind and source, and a name and height when they read', () => {
    expect(pointOf(peak, 'POINT(11.0 47.4)', ' Zugspitze ', '2962')).toEqual({
      lon: 11,
      lat: 47.4,
      kind: 'peak',
      source: 'outdoor',
      name: 'Zugspitze',
      ele: 2962,
    })
    expect(pointOf(peak, 'POINT(11.0 47.4)', undefined, 'unknown')).toEqual({
      lon: 11,
      lat: 47.4,
      kind: 'peak',
      source: 'outdoor',
    })
  })

  it('leaves out what has no tile to be in', () => {
    expect(pointOf(peak, 'POINT(0 89)', undefined, undefined)).toBeNull()
    expect(pointOf(peak, 'POINT EMPTY', undefined, undefined)).toBeNull()
  })
})
