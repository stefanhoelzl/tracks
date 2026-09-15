import { z } from 'zod'
import type { Geocoder, Place } from '../geocoder.ts'
import type { LatLon } from '../router.ts'

/**
 * Photon, at `photon.komoot.io`.
 *
 * Keyless, CORS, and built for type-ahead — which is precisely what Nominatim's usage
 * policy forbids, and the reason the obvious OSM geocoder is not the one here.
 *
 * Results are biased to the map centre rather than bounded by it. That decides the case
 * that actually comes up: Vent exists in four countries and you are looking straight at
 * one of them — while the far end of a tour you have not panned to yet still has to be
 * findable, which a bounding box would prevent.
 */

const ENDPOINT = 'https://photon.komoot.io'

/** About five. Enough to disambiguate a name, few enough to read without scrolling. */
const LIMIT = 5

const featureSchema = z.object({
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([z.number(), z.number()]),
  }),
  properties: z.object({
    name: z.string().optional(),
    housenumber: z.string().optional(),
    street: z.string().optional(),
    city: z.string().optional(),
    district: z.string().optional(),
    county: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
  }),
})

const responseSchema = z.object({
  features: z.array(featureSchema),
})

type Properties = z.infer<typeof featureSchema>['properties']

/**
 * What to call the thing.
 *
 * Photon names what it can and describes the rest, so this walks down from most to
 * least specific: a named feature, then a street address, then the settlement. The last
 * fallback is coordinates, because a `Place` promises a non-empty name and an empty row
 * in a search list is worse than a number.
 */
function nameOf(properties: Properties, lat: number, lon: number): string {
  if (properties.name) return properties.name
  if (properties.street) {
    return properties.housenumber
      ? `${properties.street} ${properties.housenumber}`
      : properties.street
  }
  return properties.city ?? properties.county ?? `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

/**
 * Where it is, in one line.
 *
 * Assembled here rather than in the row that draws it: which administrative fields
 * exist is a property of OSM's data, not of a list. Deduplicated because a village and
 * its district are frequently the same word, and "Sölden · Sölden · Tyrol" reads as a
 * bug.
 */
function contextOf(properties: Properties, name: string): string {
  const parts = [
    properties.city ?? properties.district,
    properties.state ?? properties.county,
    properties.country,
  ]

  const seen = new Set([name])
  const out: string[] = []
  for (const part of parts) {
    if (!part || seen.has(part)) continue
    seen.add(part)
    out.push(part)
  }
  return out.join(' · ')
}

function toPlace(feature: z.infer<typeof featureSchema>): Place {
  const [lon, lat] = feature.geometry.coordinates
  const name = nameOf(feature.properties, lat, lon)
  return { name, context: contextOf(feature.properties, name), lat, lon }
}

/*
 * The request and the reading of the answer, apart from `fetch`, so that the phone's port
 * can be pinned to them by fixtures.
 */

/** The query string of a search, or null when there is nothing to ask. */
export function searchParams(query: string, near: LatLon | null): URLSearchParams | null {
  const trimmed = query.trim()
  if (trimmed === '') return null

  const params = new URLSearchParams({ q: trimmed, limit: String(LIMIT), lang: 'en' })
  if (near) {
    params.set('lat', String(near.lat))
    params.set('lon', String(near.lon))
  }
  return params
}

export function reverseParams(at: LatLon): URLSearchParams {
  return new URLSearchParams({
    lat: String(at.lat),
    lon: String(at.lon),
    lang: 'en',
    limit: '1',
  })
}

/** Every place in an answer, or none when the answer is not one Photon gives. */
export function placesFrom(body: unknown): Place[] {
  const parsed = responseSchema.safeParse(body)
  return parsed.success ? parsed.data.features.map(toPlace) : []
}

export class PhotonGeocoder implements Geocoder {
  readonly id = 'photon'

  private readonly endpoint: string

  constructor(endpoint: string = ENDPOINT) {
    this.endpoint = endpoint
  }

  async search(query: string, near: LatLon | null, signal?: AbortSignal): Promise<Place[]> {
    const params = searchParams(query, near)
    if (!params) return []

    const response = await fetch(`${this.endpoint}/api/?${params}`, { signal })
    // A geocoder that is down makes the field useless, not the app: an empty result
    // list is the same shape as "nothing matched", and there is nothing here worth
    // interrupting a plan for.
    if (!response.ok) return []

    return placesFrom(await response.json())
  }

  async reverse(at: LatLon, signal?: AbortSignal): Promise<string | null> {
    const response = await fetch(`${this.endpoint}/reverse?${reverseParams(at)}`, { signal })
    if (!response.ok) return null

    return placesFrom(await response.json())[0]?.name ?? null
  }
}
