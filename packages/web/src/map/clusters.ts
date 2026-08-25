import type { MapLibreMap, Marker } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import { colourForSlot, NEUTRAL_SLOT, PALETTE_SIZE } from '../lib/colour.ts'
import { STARTS_SOURCE } from './layers.ts'

/**
 * Clusters, drawn as donuts.
 *
 * A cluster of one colour is a circle; a cluster of several is a question the map
 * should answer rather than average away. So each cluster carries a tally of the
 * palette slots inside it, and the donut is that tally — which valley is all hiking,
 * which is half rides, visible before you zoom in to find out.
 *
 * The tally has to be a `clusterProperties` accumulator because MapLibre computes it
 * inside the worker as it clusters, and the set of slots is fixed — the palette is a
 * constant, so eleven counters cover every colour any value can hash to. What cannot
 * be a layer is the drawing: a circle layer paints one colour per feature, so the
 * donuts are DOM markers positioned over the canvas.
 */

/** Each slot's counter, named `s0`…`s10`, summed over a cluster's members. */
export function clusterProperties(): Record<string, unknown> {
  const properties: Record<string, unknown> = {}

  for (let slot = 0; slot <= NEUTRAL_SLOT; slot++) {
    properties[`s${slot}`] = ['+', ['case', ['==', ['get', 'slot'], slot], 1, 0]]
  }
  return properties
}

const SIZES = [
  { upTo: 10, radius: 17, stroke: 5 },
  { upTo: 30, radius: 21, stroke: 6 },
  { upTo: Number.POSITIVE_INFINITY, radius: 26, stroke: 7 },
]

/** Bigger clusters read as bigger, but sub-linearly — 200 must not swamp the map. */
function sizeFor(count: number) {
  return SIZES.find((s) => count <= s.upTo)!
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  // A full ring has no start and end to draw between, so it is two half arcs.
  if (to - from >= 1) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}`
  }

  const point = (t: number) => {
    const angle = 2 * Math.PI * t - Math.PI / 2
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
  }
  const [x0, y0] = point(from)
  const [x1, y1] = point(to)
  const large = to - from > 0.5 ? 1 : 0

  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

/**
 * The donut for one cluster: a ring segment per slot present, and the count inside.
 *
 * Wrapped in a div because `Marker` takes an `HTMLElement`, and an `SVGElement` is
 * not one — a distinction the DOM makes and the eye does not.
 */
function donut(counts: number[], total: number): HTMLDivElement {
  const { radius, stroke } = sizeFor(total)
  const size = (radius + stroke) * 2
  const centre = size / 2
  const ring = radius

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`)
  svg.style.display = 'block'
  svg.style.cursor = 'pointer'

  const disc = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  disc.setAttribute('cx', String(centre))
  disc.setAttribute('cy', String(centre))
  disc.setAttribute('r', String(ring))
  disc.setAttribute('fill', 'rgba(255, 255, 255, 0.94)')
  svg.append(disc)

  let offset = 0
  for (const [slot, count] of counts.entries()) {
    if (count === 0) continue

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', arc(centre, centre, ring, offset / total, (offset + count) / total))
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', colourForSlot(slot))
    path.setAttribute('stroke-width', String(stroke))
    svg.append(path)

    offset += count
  }

  const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
  label.setAttribute('x', String(centre))
  label.setAttribute('y', String(centre))
  label.setAttribute('text-anchor', 'middle')
  label.setAttribute('dominant-baseline', 'central')
  label.setAttribute('font-size', total > 99 ? '11' : '12')
  label.setAttribute('font-weight', '800')
  label.setAttribute('fill', '#0f1513')
  label.textContent = String(total)
  svg.append(label)

  const wrapper = document.createElement('div')
  wrapper.style.lineHeight = '0'
  wrapper.style.filter = 'drop-shadow(0 2px 6px rgba(15, 21, 19, 0.18))'
  wrapper.append(svg)

  return wrapper
}

/**
 * Keeps one marker per visible cluster.
 *
 * Markers are reconciled rather than rebuilt: MapLibre re-clusters on every zoom, so
 * a rebuild would churn the DOM on each frame of a pinch. A cluster keeps its marker
 * while its id and tally are unchanged.
 */
export class ClusterMarkers {
  private readonly markers = new Map<number, { marker: Marker; key: string }>()
  private readonly map: MapLibreMap

  constructor(map: MapLibreMap) {
    this.map = map
  }

  refresh(): void {
    if (!this.map.getSource(STARTS_SOURCE) || !this.map.isSourceLoaded(STARTS_SOURCE)) return

    const seen = new Set<number>()

    for (const feature of this.map.querySourceFeatures(STARTS_SOURCE)) {
      const properties = feature.properties as Record<string, number> | null
      if (!properties || properties.point_count === undefined) continue

      const id = properties.cluster_id!
      seen.add(id)

      const counts = Array.from(
        { length: PALETTE_SIZE + 1 },
        (_, slot) => properties[`s${slot}`] ?? 0,
      )
      const key = counts.join(',')

      const existing = this.markers.get(id)
      if (existing?.key === key) continue
      existing?.marker.remove()

      // Clusters are always points; the union includes shapes that have no
      // `coordinates` at all, which is what the double assertion steps over.
      const coordinates = (feature.geometry as unknown as { coordinates: [number, number] })
        .coordinates
      const marker = new maplibregl.Marker({
        element: donut(counts, properties.point_count),
      })
        .setLngLat(coordinates)
        .addTo(this.map)

      // Clicking a cluster does what you meant by clicking it: go and look.
      marker.getElement().addEventListener('click', () => {
        this.map.easeTo({ center: coordinates, zoom: this.map.getZoom() + 2 })
      })

      this.markers.set(id, { marker, key })
    }

    for (const [id, entry] of this.markers) {
      if (seen.has(id)) continue
      entry.marker.remove()
      this.markers.delete(id)
    }
  }

  clear(): void {
    for (const { marker } of this.markers.values()) marker.remove()
    this.markers.clear()
  }
}

export const CLUSTER_INTERNALS = { arc, donut, sizeFor }
