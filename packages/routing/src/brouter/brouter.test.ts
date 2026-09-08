import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { RouterError, type Waypoint } from '../router.ts'
import { BRouterRouter } from './index.ts'

/**
 * Recorded responses, replayed — M2's treatment of Komoot, for the same reason. The
 * payload here is one nobody documents, so the fixture is the specification: the day
 * BRouter's shape moves, this fails with a diff instead of a browser failing quietly.
 */
const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures/brouter')
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

const ENDPOINT = 'https://brouter.de/brouter'

/** What the router asked for, so tests can assert on the wire format. */
let requests: string[] = []

/** Answers with `leg-trekking`, unless a test has queued something else. */
let queued: Array<() => Response> = []

const server = setupServer(
  http.get(ENDPOINT, ({ request }) => {
    requests.push(request.url)
    const next = queued.shift()
    return next ? next() : HttpResponse.json(fixture('leg-trekking'))
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests = []
  queued = []
})
afterAll(() => server.close())

const poi = (lon: number, lat: number, name: string | null = null): Waypoint => ({
  lon,
  lat,
  kind: 'poi',
  name,
})
const shaping = (lon: number, lat: number): Waypoint => ({ lon, lat, kind: 'routing', name: null })

const lonlats = (url: string) => new URL(url).searchParams.get('lonlats')

describe('BRouterRouter', () => {
  it('reads the track, its elevation and its metrics off the response', async () => {
    const [leg] = await new BRouterRouter().route(
      [poi(11.3931, 47.2654, 'Start'), poi(11.3975, 47.2668, 'Ende')],
      'trekking',
    )

    expect(leg?.ok).toBe(true)
    if (!leg?.ok) return

    expect(leg.distanceM).toBe(779)
    expect(leg.ascentM).toBe(1)
    expect(leg.durationS).toBe(136)
    // The elevation is the third element of every coordinate, lifted into its own
    // array — so the two must stay the same length or the profile draws against the
    // wrong point.
    expect(leg.altitudeM).toHaveLength(leg.coordinates.length)
    expect(leg.coordinates[0]).toHaveLength(2)
    expect(leg.altitudeM[0]).toBeGreaterThan(500)
  })

  it('derives descent from ascent and the two ends rather than summing it', async () => {
    const [leg] = await new BRouterRouter().route(
      [poi(11.3931, 47.2654, 'Start'), poi(11.3975, 47.2668, 'Ende')],
      'trekking',
    )
    if (!leg?.ok) throw new Error('expected a routed leg')

    const start = leg.altitudeM[0] ?? 0
    const end = leg.altitudeM[leg.altitudeM.length - 1] ?? 0
    expect(leg.descentM).toBeCloseTo(Math.max(0, leg.ascentM - (end - start)), 6)
  })

  it('names POIs on the wire and leaves shaping points bare', async () => {
    await new BRouterRouter().route(
      [poi(11.3931, 47.2654, 'Start'), shaping(11.3952, 47.2678), poi(11.3975, 47.2668, 'Gasthof')],
      'trekking',
    )

    // A named point comes back typed `via`, a bare one `shaping` — which is the whole
    // of the POI/ROUTING distinction, expressed in BRouter's own vocabulary.
    expect(lonlats(requests[0] ?? '')).toBe(
      '11.3931,47.2654,Start|11.3952,47.2678|11.3975,47.2668,Gasthof',
    )
  })

  it('sends an unnamed POI as an unnamed via, not as a shaping point', async () => {
    await new BRouterRouter().route([poi(11.3931, 47.2654), poi(11.3975, 47.2668)], 'trekking')

    expect(lonlats(requests[0] ?? '')).toBe('11.3931,47.2654,m|11.3975,47.2668,m')
  })

  it('replaces the delimiters a name might contain rather than dropping them', async () => {
    await new BRouterRouter().route(
      [poi(11.3931, 47.2654, 'Gasthof, Vent'), poi(11.3975, 47.2668, 'A|B;C')],
      'trekking',
    )

    expect(lonlats(requests[0] ?? '')).toBe('11.3931,47.2654,Gasthof  Vent|11.3975,47.2668,A B C')
  })

  it('issues one request per POI-to-POI stretch', async () => {
    queued = [
      () => HttpResponse.json(fixture('leg-trekking')),
      () => HttpResponse.json(fixture('leg-shaped')),
    ]

    const legs = await new BRouterRouter().route(
      [
        poi(11.3931, 47.2654, 'Start'),
        poi(11.3952, 47.2678, 'Mitte'),
        shaping(11.396, 47.268),
        poi(11.3975, 47.2668, 'Ende'),
      ],
      'trekking',
    )

    expect(legs).toHaveLength(2)
    expect(requests).toHaveLength(2)
    expect(lonlats(requests[0] ?? '')).toBe('11.3931,47.2654,Start|11.3952,47.2678,Mitte')
    expect(lonlats(requests[1] ?? '')).toBe(
      '11.3952,47.2678,Mitte|11.396,47.268|11.3975,47.2668,Ende',
    )
  })

  it('maps the app profile onto the engine filename', async () => {
    await new BRouterRouter().route([poi(11.3931, 47.2654), poi(11.3975, 47.2668)], 'road')

    expect(new URL(requests[0] ?? '').searchParams.get('profile')).toBe('fastbike')
  })

  it('turns a 400 into a failed leg carrying the engine reason and a beeline', async () => {
    queued = [
      () => new HttpResponse('operation killed by thread-priority-watchdog', { status: 400 }),
    ]

    const [leg] = await new BRouterRouter().route(
      [poi(9.15, 42.0, 'Corsica'), poi(11.42, 47.28, 'Tyrol')],
      'trekking',
    )

    expect(leg?.ok).toBe(false)
    if (leg?.ok !== false) return
    expect(leg.reason).toBe('operation killed by thread-priority-watchdog')
    // The shape of the plan survives the leg that could not be routed.
    expect(leg.coordinates).toEqual([
      [9.15, 42.0],
      [11.42, 47.28],
    ])
  })

  it('throws rather than blaming a waypoint when the server is refusing', async () => {
    queued = [() => new HttpResponse('Please, retry later!', { status: 403 })]

    await expect(
      new BRouterRouter().route([poi(11.3931, 47.2654), poi(11.3975, 47.2668)], 'trekking'),
    ).rejects.toBeInstanceOf(RouterError)
  })

  it('names the host it could not reach, rather than repeating "Failed to fetch"', async () => {
    server.use(http.get(ENDPOINT, () => HttpResponse.error()))

    await expect(
      new BRouterRouter().route([poi(11.3931, 47.2654), poi(11.3975, 47.2668)], 'trekking'),
    ).rejects.toThrow(/Could not reach brouter\.de/)
  })

  it('lets an abort stay an abort, since that is the caller changing its mind', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      new BRouterRouter().route(
        [poi(11.3931, 47.2654), poi(11.3975, 47.2668)],
        'trekking',
        controller.signal,
      ),
    ).rejects.not.toBeInstanceOf(RouterError)
  })

  it('routes nothing when there are fewer than two POIs', async () => {
    expect(await new BRouterRouter().route([poi(11.39, 47.26, 'Alone')], 'trekking')).toEqual([])
    expect(await new BRouterRouter().route([shaping(11.39, 47.26)], 'trekking')).toEqual([])
    expect(requests).toHaveLength(0)
  })
})
