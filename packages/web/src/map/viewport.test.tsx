import { parseFilter } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { geographicBbox } from './viewport.ts'

/**
 * The other half of every assertion here: the schema this exists to satisfy.
 *
 * Asserting the four numbers alone would let the two drift apart again — the bug being
 * fixed was exactly a pair of definitions that each looked right on its own — so every
 * case is also sent through the parser the API calls, in the form the URL carries it.
 */
function throughTheFilter(bbox: readonly number[]) {
  return parseFilter(`bbox=${bbox.join(',')}`).bbox
}

describe('the viewport as a filter', () => {
  it('narrows the first load, where the camera is wider than the world', () => {
    // The camera the app opens with when nothing in the URL has aimed it yet. Passed
    // through untouched this is a 400 and an activity list that says it could not load.
    const camera = [-190.4, -85.2, 190.4, 85.2] as const
    expect(() => throughTheFilter(camera)).toThrow()

    const bbox = geographicBbox([...camera])
    expect(bbox).toEqual([-180, -85.2, 180, 85.2])
    expect(throughTheFilter(bbox)).toEqual(bbox)
  })

  it('leaves an ordinary view exactly as the camera reported it', () => {
    // Exactly: these numbers are written to the URL, so a longitude that came back as
    // 10.240000000000009 would be a pan that changed the link without moving the map.
    const bbox = geographicBbox([10.24, 47.11, 12.43, 48.32])
    expect(bbox).toEqual([10.24, 47.11, 12.43, 48.32])
    expect(throughTheFilter(bbox)).toEqual(bbox)
  })

  it('stops at the poles, which Mercator cannot show anyway', () => {
    expect(geographicBbox([10, -95.7, 12, 95.7])).toEqual([10, -90, 12, 90])
  })

  it('widens a view across the antimeridian rather than halving it', () => {
    // Clamping the two numbers would give [170, …, 180, …], which the schema accepts
    // and which hides half of what is on the screen. Widening is visible; halving is not.
    const bbox = geographicBbox([170, -10, 190, 10])
    expect(bbox).toEqual([-180, -10, 180, 10])
    expect(throughTheFilter(bbox)).toEqual(bbox)
  })

  it('follows a camera panned clear past the antimeridian', () => {
    // Entirely east of 180 and so entirely west of it: one world, named the way the
    // schema names it, with nothing dropped and nothing added.
    const bbox = geographicBbox([190, 40, 200, 45])
    expect(bbox).toEqual([-170, 40, -160, 45])
    expect(throughTheFilter(bbox)).toEqual(bbox)
  })
})
