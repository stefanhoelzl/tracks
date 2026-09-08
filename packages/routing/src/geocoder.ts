import type { LatLon } from './router.ts'

/**
 * Finding a place, and naming one.
 *
 * Two directions of the same job, so one interface rather than two: the search field
 * turns words into places, and promoting a clicked point to a POI turns a place into
 * words. Nothing else in the app geocodes.
 */

export interface Place {
  /** What to call it. Never empty — an implementation falls back before returning. */
  name: string
  /**
   * Where it is, in words, already assembled — "Sölden · Tyrol · Austria".
   *
   * Assembled by the implementation rather than by the row that draws it, because which
   * administrative fields exist and which are worth showing is a property of the
   * geocoder's data, not of the list.
   */
  context: string
  lat: number
  lon: number
}

export interface Geocoder {
  readonly id: string
  /**
   * `near` biases rather than restricts. Vent exists in four countries and you are
   * usually looking straight at the one you mean — but the far end of a tour you have
   * not panned to yet still has to be findable, which a bounding box would prevent.
   */
  search(query: string, near: LatLon | null, signal?: AbortSignal): Promise<Place[]>
  /** What is here, for naming a POI. Null when the service knows of nothing. */
  reverse(at: LatLon, signal?: AbortSignal): Promise<string | null>
}
