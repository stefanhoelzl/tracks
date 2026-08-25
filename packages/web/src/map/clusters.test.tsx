import { createPropertyExpression, latest } from '@maplibre/maplibre-gl-style-spec'
import { describe, expect, it } from 'vitest'
import { colourForSlot, NEUTRAL_SLOT, PALETTE_SIZE, preferredSlot } from '../lib/colour.ts'
import { CLUSTER_INTERNALS, clusterProperties } from './clusters.ts'

const { arc, donut } = CLUSTER_INTERNALS

/** The strokes of a rendered donut, in the order they were drawn. */
function strokes(element: HTMLElement): string[] {
  return [...element.querySelectorAll('path')].map((p) => p.getAttribute('stroke')!)
}

describe('the cluster tally', () => {
  it('counts one accumulator per palette slot, plus one for not set', () => {
    const properties = clusterProperties()
    expect(Object.keys(properties)).toHaveLength(PALETTE_SIZE + 1)
    expect(properties).toHaveProperty(`s${NEUTRAL_SLOT}`)
  })

  it('accumulates expressions MapLibre can compile', () => {
    // These run inside the clustering worker, where a malformed one is a silent
    // absence rather than an error anyone sees.
    const spec = (latest as unknown as Record<string, Record<string, unknown>>).paint_circle!

    for (const [name, accumulator] of Object.entries(clusterProperties())) {
      const [operator, expression] = accumulator as [string, unknown]
      expect(operator, name).toBe('+')

      const compiled = createPropertyExpression(expression, name, spec['circle-radius'] as never)
      expect(compiled.result, `${name} failed to compile`).toBe('success')
    }
  })

  it('tallies a member into exactly the slot its colour came from', () => {
    const slot = preferredSlot('sport:hike')
    const counters = clusterProperties()

    // The accumulator for that slot counts 1 for this member; every other counts 0.
    for (const [name, accumulator] of Object.entries(counters)) {
      const [, expression] = accumulator as [string, unknown]
      const spec = (latest as unknown as Record<string, Record<string, unknown>>).paint_circle!
      const compiled = createPropertyExpression(expression, name, spec['circle-radius'] as never)
      if (compiled.result !== 'success') throw new Error(`${name} did not compile`)

      const value = compiled.value.evaluate({ zoom: 5 } as never, { properties: { slot } } as never)
      expect(value, name).toBe(name === `s${slot}` ? 1 : 0)
    }
  })
})

describe('the donut', () => {
  it('draws one segment per slot present, in palette order', () => {
    const counts = new Array<number>(PALETTE_SIZE + 1).fill(0)
    counts[1] = 3
    counts[4] = 1

    const element = donut(counts, 4)
    expect(strokes(element)).toEqual([colourForSlot(1), colourForSlot(4)])
  })

  it('shows the total, not the segment counts', () => {
    const counts = new Array<number>(PALETTE_SIZE + 1).fill(0)
    counts[0] = 7
    counts[2] = 5

    expect(donut(counts, 12).querySelector('text')!.textContent).toBe('12')
  })

  it('draws a single-colour cluster as one closed ring', () => {
    const counts = new Array<number>(PALETTE_SIZE + 1).fill(0)
    counts[3] = 9

    const paths = donut(counts, 9).querySelectorAll('path')
    expect(paths).toHaveLength(1)
    // A full circle has no distinct start and end, so it is drawn as a sweep that
    // returns to where it began rather than an arc between two different points.
    expect(paths[0]!.getAttribute('d')).toMatch(/A .* 1 1 /)
  })

  it('gives *not set* the neutral, which is not one of the ten hues', () => {
    const counts = new Array<number>(PALETTE_SIZE + 1).fill(0)
    counts[NEUTRAL_SLOT] = 2

    const [stroke] = strokes(donut(counts, 2))
    expect(stroke).toBe(colourForSlot(NEUTRAL_SLOT))
    for (let slot = 0; slot < PALETTE_SIZE; slot++) {
      expect(stroke).not.toBe(colourForSlot(slot))
    }
  })

  it('grows with the cluster, sub-linearly', () => {
    const of = (total: number) => {
      const counts = new Array<number>(PALETTE_SIZE + 1).fill(0)
      counts[0] = total
      return Number(donut(counts, total).querySelector('svg')!.getAttribute('width'))
    }

    expect(of(3)).toBeLessThan(of(20))
    expect(of(20)).toBeLessThan(of(200))
    // Twenty times the members must not be twenty times the circle.
    expect(of(200)).toBeLessThan(of(3) * 3)
  })

  it('closes every arc it opens', () => {
    // Segments must tile the ring exactly: a rounding gap reads as a missing sport.
    const halves = arc(50, 50, 20, 0, 0.5)
    const other = arc(50, 50, 20, 0.5, 1)

    const end = halves.split('A')[1]!.trim().split(/\s+/).slice(-2).join(' ')
    expect(other).toContain(`M ${end}`)
  })
})
