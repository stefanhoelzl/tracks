import { describe, expect, it } from 'vitest'
import { type Bbox, crossesViewport } from './viewport.ts'

/** A one-degree square with its corner at the origin. `[west, south, east, north]`. */
const BOX: Bbox = [0, 0, 1, 1]

/** Coordinates go in as the polyline codec emits them: `[lat, lon]`. */
const line = (...pairs: Array<[number, number]>) => pairs

describe('crossesViewport', () => {
  it('accepts a line with a point inside', () => {
    expect(crossesViewport(line([0.5, 0.5], [5, 5]), BOX)).toBe(true)
  })

  it('accepts a line that cuts a corner with both ends outside', () => {
    // Enters through the west edge and leaves through the south, touching neither end
    // inside — the case a point test cannot see and the whole reason for the clip.
    expect(crossesViewport(line([0.1, -0.1], [-0.1, 0.1]), BOX)).toBe(true)
  })

  it('accepts a line that crosses clean through', () => {
    expect(crossesViewport(line([0.5, -1], [0.5, 2]), BOX)).toBe(true)
  })

  it('rejects a line that passes outside a corner', () => {
    // A diagonal beyond the north-east corner. Both ends are outside *and* its own
    // bounding box overlaps the viewport's, so the cheap rejection cannot answer it and
    // the clip has to — which is the only case in here that reaches that code at all.
    expect(crossesViewport(line([1.5, 0.8], [0.8, 1.5]), BOX)).toBe(false)
  })

  it('rejects a line wholly outside', () => {
    expect(crossesViewport(line([5, 5], [6, 6]), BOX)).toBe(false)
  })

  it('accepts a line running along an edge', () => {
    // Parallel to an edge and lying on it: touching counts, because the filter's
    // question is "is this in view", and a track on the boundary is.
    expect(crossesViewport(line([0, -1], [0, 2]), BOX)).toBe(true)
  })

  it('rejects a line parallel to an edge and outside it', () => {
    expect(crossesViewport(line([-0.5, -1], [-0.5, 2]), BOX)).toBe(false)
  })

  it('treats a single recorded point as a point', () => {
    expect(crossesViewport(line([0.5, 0.5]), BOX)).toBe(true)
    expect(crossesViewport(line([5, 5]), BOX)).toBe(false)
  })

  it('says nothing crosses an empty line', () => {
    expect(crossesViewport([], BOX)).toBe(false)
  })

  it('accepts a zero-length segment inside, and rejects one outside', () => {
    // A stationary recording: both ends identical, so there is no direction to clip
    // against and the early inside-check is what answers it.
    expect(crossesViewport(line([0.5, 0.5], [0.5, 0.5]), BOX)).toBe(true)
    expect(crossesViewport(line([5, 5], [5, 5]), BOX)).toBe(false)
  })

  it('finds a crossing on any segment, not only the first', () => {
    expect(crossesViewport(line([9, 9], [8, 8], [0.5, 0.5]), BOX)).toBe(true)
  })
})
