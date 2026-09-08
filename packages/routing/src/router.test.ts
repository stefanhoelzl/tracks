import { describe, expect, it } from 'vitest'
import { descentOf, stretches, type Waypoint } from './router.ts'

const poi = (lon: number, name: string): Waypoint => ({ lon, lat: 47, kind: 'poi', name })
const shaping = (lon: number): Waypoint => ({ lon, lat: 47, kind: 'routing', name: null })

const names = (runs: Waypoint[][]) => runs.map((run) => run.map((w) => w.name ?? `~${w.lon}`))

describe('stretches', () => {
  it('cuts at every POI, keeping shaping points inside the run they shape', () => {
    expect(
      names(stretches([poi(0, 'a'), shaping(1), poi(2, 'b'), shaping(3), shaping(4), poi(5, 'c')])),
    ).toEqual([
      ['a', '~1', 'b'],
      ['b', '~3', '~4', 'c'],
    ])
  })

  it('drops shaping points that have no leg to belong to', () => {
    // A hint about how to get somewhere is meaningless before the first place and
    // after the last one.
    expect(names(stretches([shaping(0), poi(1, 'a'), poi(2, 'b'), shaping(3)]))).toEqual([
      ['a', 'b'],
    ])
  })

  it('yields nothing below two POIs', () => {
    expect(stretches([])).toEqual([])
    expect(stretches([poi(0, 'a')])).toEqual([])
    expect(stretches([shaping(0), shaping(1)])).toEqual([])
  })
})

describe('descentOf', () => {
  it('is ascent less the net climb, so the two readouts cannot disagree', () => {
    // Up 100 having finished 40 higher than you started: 60 of it came back down.
    expect(descentOf(100, [500, 620, 540])).toBe(60)
  })

  it('equals the ascent on a loop', () => {
    expect(descentOf(340, [800, 1100, 800])).toBe(340)
  })

  it('never goes negative, however filtered the ascent it was given', () => {
    // A filtered ascent discards small wobbles, so it can be smaller than the net
    // climb on a stretch that only ever goes up. Descent is then zero, not -18.
    expect(descentOf(2, [500, 520])).toBe(0)
  })

  it('is zero when there is no elevation to reason about', () => {
    expect(descentOf(100, [])).toBe(0)
  })
})
