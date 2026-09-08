import { describe, expect, it } from 'vitest'
import { GRADE, gradeColour, rampPosition } from './chart-theme.ts'

describe('rampPosition', () => {
  /**
   * The anchors are not evenly spaced and the ramp is drawn as if they were, so this
   * is the one place an off-by-a-percent would be silent and permanent.
   */
  it('lands each anchor on its own stop', () => {
    expect(GRADE.map((stop) => rampPosition(stop.at))).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
  })

  it('interpolates between two anchors', () => {
    // Halfway from +4% to +8%, which is halfway from yellow to orange.
    expect(rampPosition(6)).toBeCloseTo(0.5, 10)
    // A quarter of the way from 0% to +4%.
    expect(rampPosition(1)).toBeCloseTo(0.25, 10)
  })

  it('clamps rather than running off either end', () => {
    expect(rampPosition(-40)).toBe(0)
    expect(rampPosition(99)).toBe(1)
  })

  // Flat is green, not yellow: "green for downhill or flat" is the whole scale.
  it('paints level ground green', () => {
    expect(gradeColour(0)).toBe(GRADE[1].colour)
  })
})

describe('gradeColour', () => {
  it('is exactly the anchor at an anchor', () => {
    expect(GRADE.map((stop) => gradeColour(stop.at))).toEqual(GRADE.map((stop) => stop.colour))
  })

  it('mixes the two anchors it falls between', () => {
    // Midway from #e3c033 to #dd8531, channel by channel.
    expect(gradeColour(6)).toBe('#e0a332')
  })

  it('clamps past the ends of the ramp', () => {
    expect(gradeColour(-30)).toBe(GRADE[0].colour)
    expect(gradeColour(30)).toBe(GRADE[5].colour)
  })
})
