import type { BandKey, Metric } from '@tracks/core'
import { duration, group, km, kmh, metres } from './format.ts'

/**
 * How the analytics metrics are said.
 *
 * The aggregations work in SI, like every other number on this side of the wire, so
 * this is the one place the panel converts — the same division of labour `format.ts`
 * already draws, extended to the two shapes a chart needs: a terse axis tick and a
 * fuller line in a tooltip.
 */

export const METRIC_UNITS: Record<
  Metric,
  { label: string; unit: string; axis: (value: number) => string; tip: (value: number) => string }
> = {
  distance: {
    label: 'distance',
    unit: 'km',
    axis: (value) => km(value, 0),
    tip: (value) => `${group(Math.round(value / 1000))} km`,
  },
  elevation: {
    label: 'elevation',
    unit: 'm',
    axis: (value) => metres(value),
    tip: (value) => `${metres(value)} m up`,
  },
  duration: {
    label: 'moving time',
    unit: 'h',
    axis: (value) => String(Math.round(value / 3600)),
    tip: (value) => `${duration(value)} h`,
  },
  count: {
    label: 'activities',
    unit: '',
    axis: (value) => String(Math.round(value)),
    tip: (value) => `${Math.round(value)} ${value === 1 ? 'activity' : 'activities'}`,
  },
}

/** The four distribution cards, in SI, with the words their band edges are read in. */
export const BAND_UNITS: Record<
  BandKey,
  { label: string; unit: string; edge: (v: number) => string }
> = {
  distance: { label: 'Distance', unit: 'km', edge: (v) => km(v, 0) },
  elevation: { label: 'Elevation', unit: 'm', edge: (v) => String(Math.round(v)) },
  duration: { label: 'Moving time', unit: 'h', edge: (v) => String(Math.round(v / 3600)) },
  speed: { label: 'Speed', unit: 'km/h', edge: (v) => kmh(v, 0) },
}

/** `0–5`, `100+` — a band's own name, which is also its axis label. */
export function bandLabel(edge: { min: number; max: number | null }, key: BandKey): string {
  const { edge: format } = BAND_UNITS[key]
  return edge.max === null ? `${format(edge.min)}+` : `${format(edge.min)}–${format(edge.max)}`
}
