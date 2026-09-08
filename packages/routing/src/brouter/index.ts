import { z } from 'zod'
import {
  descentOf,
  type Leg,
  type Profile,
  type Router,
  RouterError,
  stretches,
  type Waypoint,
} from '../router.ts'

/**
 * BRouter, at `brouter.de`.
 *
 * Keyless, `Access-Control-Allow-Origin: *`, and the router people who care about
 * bicycles actually use. Its GeoJSON carries three-element coordinates, so elevation
 * arrives with the geometry rather than from a second service, and it reports a
 * *filtered* ascent separately from a plain one — the filtered figure being the one
 * that agrees with what Strava says about the same hill.
 *
 * Its wire format already contains this app's central distinction. In `lonlats`, a
 * point given a name comes back typed `via` and a bare one comes back `shaping`, which
 * is POI and ROUTING under other names — so the mapping below is barely a mapping.
 *
 * None of this is documented. The API reference is `ServerHandler.java`, and every fact
 * here was established by reading that and then calling the endpoint.
 */

const ENDPOINT = 'https://brouter.de/brouter'

/** Their filenames for our five words. */
const PROFILE_FILES = {
  road: 'fastbike',
  trekking: 'trekking',
  gravel: 'gravel',
  mtb: 'mtb',
  hiking: 'hiking-mountain',
} as const satisfies Record<Profile, string>

/**
 * BRouter emits every number as a string, so the schema coerces rather than pretending
 * otherwise. Coordinates are `[lon, lat, ele]`, but a stretch with no elevation data
 * would be `[lon, lat]`, so the third element is not required for the parse to succeed.
 */
const trackSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z
    .array(
      z.object({
        geometry: z.object({
          type: z.literal('LineString'),
          coordinates: z.array(z.array(z.number()).min(2)),
        }),
        properties: z.object({
          'track-length': z.coerce.number(),
          'filtered ascend': z.coerce.number(),
          'total-time': z.coerce.number(),
        }),
      }),
    )
    .min(1),
})

/**
 * `lonlats` is delimited by commas and pipes, so a name carrying either would rewrite
 * the request. Both become spaces rather than being dropped: "Gasthof, Vent" is a name
 * someone typed, and silently turning it into "GasthofVent" is worse than a space.
 */
function wireName(name: string): string {
  return name.replace(/[,;|]/g, ' ').trim()
}

/**
 * One waypoint, in BRouter's own vocabulary.
 *
 * A named point is a `via` — a break, where the router may turn around. A bare one is
 * `shaping` — passed through in stride. A POI with no name yet still has to be a break,
 * so it is sent as `m`, which is BRouter's unnamed via.
 */
function wirePoint(waypoint: Waypoint): string {
  const at = `${waypoint.lon},${waypoint.lat}`
  if (waypoint.kind !== 'poi') return at
  const name = waypoint.name ? wireName(waypoint.name) : ''
  return name === '' ? `${at},m` : `${at},${name}`
}

export class BRouterRouter implements Router {
  readonly id = 'brouter'
  readonly profiles = ['road', 'trekking', 'gravel', 'mtb', 'hiking'] as const

  private readonly endpoint: string

  constructor(endpoint: string = ENDPOINT) {
    this.endpoint = endpoint
  }

  /**
   * One request per POI-to-POI stretch.
   *
   * Not a shortcoming worked around: BRouter answers with a single geometry and no leg
   * breakdown, so per-leg distances need per-leg calls whatever the semantics. The
   * design wanted legs bounded by breaks and the provider wanted the same thing.
   *
   * Sequential rather than parallel, because the endpoint is one enthusiast's machine
   * and a plan is edited one leg at a time anyway — the cache above this means a whole
   * plan is only ever requested at once when a shared link is first opened.
   */
  async route(
    waypoints: readonly Waypoint[],
    profile: Profile,
    signal?: AbortSignal,
  ): Promise<Leg[]> {
    const legs: Leg[] = []
    for (const stretch of stretches(waypoints)) {
      legs.push(await this.leg(stretch, profile, signal))
    }
    return legs
  }

  private async leg(stretch: Waypoint[], profile: Profile, signal?: AbortSignal): Promise<Leg> {
    const from = stretch[0]
    const to = stretch[stretch.length - 1]
    // `stretches` only ever yields runs of two or more, both ends POIs.
    if (!from || !to) throw new RouterError('a leg needs two ends')

    const params = new URLSearchParams({
      lonlats: stretch.map(wirePoint).join('|'),
      profile: PROFILE_FILES[profile],
      alternativeidx: '0',
      format: 'geojson',
    })

    const response = await fetch(`${this.endpoint}?${params}`, { signal })

    if (!response.ok) {
      const body = (await response.text()).trim()
      // 400 is the engine saying *these two cannot be connected* — a fact about the
      // plan, which belongs on the row. Everything else (403 "Please, retry later!",
      // 500 on a bad profile) is a fact about the server, and pinning it to a waypoint
      // would be a lie that persists after the server recovers.
      if (response.status === 400) {
        return {
          ok: false,
          from,
          to,
          coordinates: [
            [from.lon, from.lat],
            [to.lon, to.lat],
          ],
          reason: body === '' ? 'No route found' : body,
        }
      }
      throw new RouterError(
        body === '' ? `BRouter returned ${response.status}` : body,
        response.status,
      )
    }

    const parsed = trackSchema.safeParse(await response.json())
    if (!parsed.success)
      throw new RouterError(`BRouter sent an unrecognised track: ${parsed.error.message}`)

    const feature = parsed.data.features[0]
    if (!feature) throw new RouterError('BRouter sent no track')

    const coordinates: Array<[number, number]> = []
    const altitudeM: number[] = []
    for (const point of feature.geometry.coordinates) {
      const [lon, lat, ele] = point
      if (lon === undefined || lat === undefined) continue
      coordinates.push([lon, lat])
      altitudeM.push(ele ?? 0)
    }

    const ascentM = feature.properties['filtered ascend']

    return {
      ok: true,
      from,
      to,
      coordinates,
      altitudeM,
      distanceM: feature.properties['track-length'],
      ascentM,
      descentM: descentOf(ascentM, altitudeM),
      durationS: feature.properties['total-time'],
    }
  }
}
