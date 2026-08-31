import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { toFrame } from '../lib/import.ts'
import { KomootClient, KomootError } from './komoot/client.ts'
import { KomootSource } from './komoot/index.ts'
import { sportTags } from './komoot/sport.ts'

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures/komoot')
const USER = '1234567890123'

const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

/** Records what the client asked for, so tests can assert on the request shape. */
let requests: Array<{ url: string; authorization: string }> = []

const server = setupServer(
  http.get('https://api.komoot.de/v006/account/email/:email/', ({ request }) => {
    requests.push({ url: request.url, authorization: request.headers.get('authorization') ?? '' })
    return HttpResponse.json(fixture('login'))
  }),
  http.get(`https://api.komoot.de/v007/users/${USER}/tours/`, ({ request }) => {
    requests.push({ url: request.url, authorization: request.headers.get('authorization') ?? '' })
    const page = new URL(request.url).searchParams.get('page')
    return HttpResponse.json(fixture(page === '1' ? 'tours-page-2' : 'tours-page-1'))
  }),
  http.get('https://api.komoot.de/v007/tours/:id', ({ request, params }) => {
    requests.push({ url: request.url, authorization: request.headers.get('authorization') ?? '' })
    return HttpResponse.json(fixture(`tour-${params.id}`))
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests = []
})
afterAll(() => server.close())

// delayMs: 0 keeps the polite pacing out of the test suite's wall clock.
const options = { email: 'rider@example.com', password: 'secret', delayMs: 0 }

describe('KomootClient', () => {
  it('authenticates with the session token, never the password', async () => {
    const client = new KomootClient(options)
    await client.login()
    for await (const _ of client.tours()) break

    const [login, list] = requests
    expect(login?.authorization).toBe(`Basic ${btoa('rider@example.com:secret')}`)
    // The 64-char token from the login response replaces the password afterwards.
    expect(list?.authorization).toBe(`Basic ${btoa(`${USER}:${'x'.repeat(64)}`)}`)
    expect(list?.authorization).not.toContain(btoa('secret'))
  })

  it('encodes a password the browser cannot btoa directly', async () => {
    // btoa throws above U+00FF, so the header is built from UTF-8 bytes.
    await new KomootClient({ ...options, password: 'pässwörd€' }).login()
    const expected = btoa(
      String.fromCharCode(...new TextEncoder().encode('rider@example.com:pässwörd€')),
    )
    expect(requests[0]?.authorization).toBe(`Basic ${expected}`)
  })

  it('follows the API pagination links to the end', async () => {
    const client = new KomootClient(options)
    const ids = []
    for await (const tour of client.tours()) ids.push(String(tour.id))

    expect(ids).toHaveLength(3) // 2 on page one, 1 on page two
    expect(requests.filter((r) => r.url.includes('/tours/?')).length).toBe(2)
  })

  it('retries a rate limit, then succeeds', async () => {
    let attempts = 0
    server.use(
      http.get('https://api.komoot.de/v006/account/email/:email/', () => {
        attempts++
        if (attempts === 1) {
          return new HttpResponse(null, { status: 429, headers: { 'retry-after': '0' } })
        }
        return HttpResponse.json(fixture('login'))
      }),
    )
    await expect(new KomootClient(options).login()).resolves.toBe(USER)
    expect(attempts).toBe(2)
  })

  it('gives up on a client error without leaking the URL, and says it was a 401', async () => {
    server.use(
      http.get('https://api.komoot.de/v006/account/email/:email/', () =>
        HttpResponse.json({ error: 'nope' }, { status: 401 }),
      ),
    )
    // The URL embeds the account email, so it must not reach the message.
    await expect(new KomootClient(options).login()).rejects.toThrow(/401/)
    await expect(new KomootClient(options).login()).rejects.not.toThrow(/example\.com/)
    // The status is carried so the dialog can blame the credentials specifically.
    await expect(new KomootClient(options).login()).rejects.toBeInstanceOf(KomootError)
  })

  it('stops when the import is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      new KomootClient({ ...options, signal: controller.signal }).login(),
    ).rejects.toThrow()
  })
})

describe('KomootSource', () => {
  it('imports recorded tours and skips planned ones', async () => {
    const listed = await collect(new KomootSource(options).listActivities())

    expect(listed).toHaveLength(2) // the third fixture tour is tour_planned
    expect(listed.map((a) => a.externalId)).toEqual(['1000000002', '1000000001'])
  })

  it('maps moving and elapsed time to the right columns', async () => {
    const [first] = await collect(new KomootSource(options).listActivities())

    expect(first?.durationS).toBe(8644) // time_in_motion
    expect(first?.elapsedS).toBe(11800) // duration
    expect(first?.elevationGainM).toBeCloseTo(425.13, 2) // elevation_up
  })

  it('converts millisecond offsets into absolute timestamps', async () => {
    const source = new KomootSource(options)
    await collect(source.listActivities()) // populates the start times
    const track = await source.fetchTrack('1000000002')

    const start = Math.round(new Date('2026-08-20T06:36:58.000Z').getTime() / 1000)
    expect(track?.points[0]?.recordedAt).toBe(start) // t = 0
    expect(track?.points[1]?.recordedAt).toBe(start + 8) // t = 7999 ms
    expect(track?.points[0]?.lon).toBe(14.341424) // lng -> lon
    expect(track?.points[0]?.altitudeM).toBe(594.3) // alt -> altitudeM
  })

  it('leaves timestamps null when a tour carries no real timing', async () => {
    server.use(
      http.get('https://api.komoot.de/v007/tours/:id', () => {
        const tour = fixture('tour-1000000002')
        for (const item of tour._embedded.coordinates.items) item.t = 0
        return HttpResponse.json(tour)
      }),
    )
    const source = new KomootSource(options)
    await collect(source.listActivities())
    const track = await source.fetchTrack('1000000002')

    // Stamping every point at the start would be worse than admitting we do not know.
    expect(track?.points.every((p) => p.recordedAt === null)).toBe(true)
    // And the frame says so in one word rather than in a column of nulls.
    const [activity] = await collect(source.listActivities())
    expect(toFrame('komoot', activity!, track!).times).toBeNull()
  })

  it('verifies credentials before anything is read', async () => {
    server.use(
      http.get('https://api.komoot.de/v006/account/email/:email/', () =>
        HttpResponse.json({ error: 'nope' }, { status: 401 }),
      ),
    )
    await expect(new KomootSource(options).verify()).rejects.toThrow(/401/)
  })
})

describe("Komoot's own sport vocabulary", () => {
  it('collapses distinctions Strava does not make', () => {
    // Komoot separates these three; a Strava GPX says only 'cycling'. Keeping them
    // apart would make the two accounts incomparable.
    expect(sportTags('touringbicycle')).toEqual(['sport:bike'])
    expect(sportTags('racebike')).toEqual(['sport:bike'])
    expect(sportTags('e_mtb')).toEqual(['sport:bike'])
    expect(sportTags('mountaineering')).toEqual(['sport:hike'])
    expect(sportTags('jogging')).toEqual(['sport:run'])
  })

  it('derives nothing from a sport it does not know', () => {
    expect(sportTags(null)).toEqual([])
    expect(sportTags('skitour')).toEqual([])
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of iterable) out.push(item)
  return out
}
