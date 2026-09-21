import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import type { StyleSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { washedColorful } from './colorful.ts'
import { beforeOf, concat, overlaysFor, type Platform } from './overlay-spec.ts'
import { OVERLAYS } from './overlays.ts'
import { REFERENCE_OVERLAYS } from './reference-overlays.ts'

const PLATFORMS: Platform[] = ['web', 'app']

/** The basemap with one platform's overlays over it, as that platform ends up drawing it. */
function drawnBy(platform: Platform): StyleSpecification {
  const basemap = washedColorful() as StyleSpecification
  const { sources, layers } = overlaysFor(OVERLAYS, platform)
  return {
    ...basemap,
    sources: { ...basemap.sources, ...sources },
    layers: [...basemap.layers, ...layers],
  }
}

describe('the overlays both platforms draw', () => {
  it.each(PLATFORMS)('is a style MapLibre accepts, over the basemap, on the %s', (platform) => {
    expect(validateStyleMin(drawnBy(platform))).toEqual([])
  })

  it.each(PLATFORMS)('draws every layer on the %s from a source that platform has', (platform) => {
    const { sources, layers } = overlaysFor(OVERLAYS, platform)
    for (const layer of layers) {
      expect(
        Object.keys(sources),
        `${layer.id} reads ${'source' in layer ? layer.source : ''}`,
      ).toContain((layer as { source: string }).source)
    }
  })

  it('names every layer once, and never a layer of the basemap', () => {
    const ids = OVERLAYS.layers.map((layer) => layer.id)
    expect(new Set(ids).size).toBe(ids.length)
    const basemap = new Set(
      (washedColorful() as StyleSpecification).layers.map((layer) => layer.id),
    )
    expect(ids.filter((id) => basemap.has(id))).toEqual([])
  })

  it('keeps the contours, the archive and dropped files to the web, and the ride and the cone to the phone', () => {
    const web = overlaysFor(OVERLAYS, 'web').layers.map((layer) => layer.id)
    const app = overlaysFor(OVERLAYS, 'app').layers.map((layer) => layer.id)
    for (const id of ['contour-lines', 'tracks-base', 'reference-line', 'plan-preview-ring']) {
      expect(web).toContain(id)
      expect(app).not.toContain(id)
    }
    for (const id of ['ridden', 'rider-facing']) {
      expect(app).toContain(id)
      expect(web).not.toContain(id)
    }
    for (const id of [
      'plan-casing',
      'plan-line',
      'plan-failed',
      'plan-pending',
      'plan-poi',
      'range-line',
      'cursor-dot',
    ]) {
      expect(web).toContain(id)
      expect(app).toContain(id)
    }
  })

  it('takes the metadata off every source, which the style spec has no place for', () => {
    for (const platform of PLATFORMS) {
      for (const source of Object.values(overlaysFor(OVERLAYS, platform).sources)) {
        expect(source).not.toHaveProperty('metadata')
      }
    }
  })

  it('puts a layer under its `before` where that is drawn, and on top where it is not', () => {
    const [reference] = REFERENCE_OVERLAYS.layers
    if (!reference) throw new Error('no reference layer')
    expect(beforeOf(reference, (id) => id === 'plan-casing')).toBe('plan-casing')
    expect(beforeOf(reference, () => false)).toBeUndefined()
    expect(beforeOf(OVERLAYS.layers.at(-1) ?? reference, () => true)).toBeUndefined()
  })

  it('keeps the list order when parts are joined, since the order is the stack', () => {
    const joined = concat(REFERENCE_OVERLAYS, REFERENCE_OVERLAYS)
    expect(joined.layers.slice(0, REFERENCE_OVERLAYS.layers.length)).toEqual(
      REFERENCE_OVERLAYS.layers,
    )
  })
})
