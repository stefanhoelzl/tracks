import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { PhotonGeocoder } from './index.ts'

const FIXTURES = resolve(import.meta.dirname, '../../../../fixtures/photon')
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8'))

let requests: string[] = []
let searchStatus = 200

const server = setupServer(
  http.get('https://photon.komoot.io/api/', ({ request }) => {
    requests.push(request.url)
    if (searchStatus !== 200) return new HttpResponse(null, { status: searchStatus })
    return HttpResponse.json(fixture('search-vent'))
  }),
  http.get('https://photon.komoot.io/reverse', ({ request }) => {
    requests.push(request.url)
    return HttpResponse.json(fixture('reverse-innsbruck'))
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  requests = []
  searchStatus = 200
})
afterAll(() => server.close())

const param = (url: string, key: string) => new URL(url).searchParams.get(key)

describe('PhotonGeocoder', () => {
  it('turns features into places with a name, a context line and coordinates', async () => {
    const places = await new PhotonGeocoder().search('Vent', null)

    expect(places[0]).toEqual({
      name: 'Vent',
      context: 'Sölden · Tyrol · Austria',
      lat: 46.8600108,
      lon: 10.9146696,
    })
  })

  it('biases to the map centre rather than bounding to it', async () => {
    await new PhotonGeocoder().search('Vent', { lat: 47.26, lon: 11.39 })

    const url = requests[0] ?? ''
    expect(param(url, 'lat')).toBe('47.26')
    expect(param(url, 'lon')).toBe('11.39')
    // A bbox would make the far end of a tour you have not panned to unfindable.
    expect(param(url, 'bbox')).toBeNull()
  })

  it('asks for nothing at all on an empty query', async () => {
    expect(await new PhotonGeocoder().search('   ', null)).toEqual([])
    expect(requests).toHaveLength(0)
  })

  it('treats a geocoder that is down as nothing matching', async () => {
    searchStatus = 503

    // The field going quiet is right; interrupting a plan over a search box is not.
    expect(await new PhotonGeocoder().search('Vent', null)).toEqual([])
  })

  it('names a clicked point from what is there', async () => {
    expect(await new PhotonGeocoder().reverse({ lat: 47.2654, lon: 11.3931 })).toBe('Lacoste')
  })

  it('never repeats the name inside its own context line', async () => {
    server.use(
      http.get('https://photon.komoot.io/api/', () =>
        HttpResponse.json({
          features: [
            {
              geometry: { type: 'Point', coordinates: [11.0, 47.0] },
              properties: { name: 'Sölden', city: 'Sölden', state: 'Tyrol', country: 'Austria' },
            },
          ],
        }),
      ),
    )

    const [place] = await new PhotonGeocoder().search('Sölden', null)
    expect(place?.context).toBe('Tyrol · Austria')
  })

  it('falls back to a street address, then a settlement, then coordinates', async () => {
    server.use(
      http.get('https://photon.komoot.io/api/', () =>
        HttpResponse.json({
          features: [
            {
              geometry: { type: 'Point', coordinates: [11.0, 47.0] },
              properties: {
                street: 'Maria-Theresien-Straße',
                housenumber: '18',
                city: 'Innsbruck',
              },
            },
            {
              geometry: { type: 'Point', coordinates: [11.1, 47.1] },
              properties: { city: 'Innsbruck' },
            },
            { geometry: { type: 'Point', coordinates: [11.2, 47.2] }, properties: {} },
          ],
        }),
      ),
    )

    const places = await new PhotonGeocoder().search('anything', null)
    expect(places.map((place) => place.name)).toEqual([
      'Maria-Theresien-Straße 18',
      'Innsbruck',
      '47.2000, 11.2000',
    ])
  })
})
