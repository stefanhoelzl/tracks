import polyline from '@mapbox/polyline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { altitudesToScalars, encodeScalars, TRACK_PRECISION } from '@tracks/core'
import { useImperativeHandle } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** What the app asked the map to do. Reset per test in `beforeEach`. */
const flyTo = vi.fn()

/**
 * That the whole app composes, fetches and wires itself together.
 *
 * The map is stubbed rather than rendered: MapLibre needs a WebGL context jsdom does
 * not have, and what is worth asserting here is the wiring — that a filter written by
 * the sidebar reaches the URL, the URL reaches the query keys, and the responses reach
 * the panels. The map's own behaviour is exercised by hand, not here.
 */
vi.mock('./components/MapView.tsx', () => ({
  MapView: (props: {
    ref?: React.Ref<{ flyTo: (at: { lat: number; lon: number }) => void }>
    tracks?: { features: unknown[] }
    pin?: React.ReactNode
    onMapClick?: (at: { lat: number; lon: number }) => void
  }) => {
    // The imperative half of the real component, so the calls the app makes through
    // the handle are visible here rather than vanishing into a null ref.
    useImperativeHandle(props.ref, () => ({ flyTo, centre: () => null }) as never)

    return (
      <div data-testid="map">
        <span data-testid="track-count">{props.tracks?.features.length ?? 0} tracks</span>
        {/* The map's own behaviour is exercised by hand; what a test can drive is the
          one thing it hands back, which is a click at a place. Two places, well apart,
          because which leg a click means is decided by distance. */}
        <button type="button" onClick={() => props.onMapClick?.({ lat: 47.26, lon: 11.39 })}>
          click the map
        </button>
        <button type="button" onClick={() => props.onMapClick?.({ lat: 47.3, lon: 11.5 })}>
          click elsewhere
        </button>
        {props.pin}
      </div>
    )
  },
}))

/**
 * A fake router and geocoder, so planning composes without a network.
 *
 * What the real adapters do with a real payload is tested against recorded responses
 * in `packages/routing`; what is worth asserting here is that the mode switch swaps
 * both panels and that leaving takes the plan with it.
 */
vi.mock('./lib/routing.ts', () => ({
  router: { id: 'fake', profiles: ['trekking'], route: async () => [] },
  geocoder: {
    id: 'fake',
    search: async () => [
      { name: 'Vent', context: 'Sölden · Tyrol · Austria', lat: 46.86, lon: 10.91 },
    ],
    reverse: async () => null,
  },
  usePlanLegs: () => ({ legs: [], pending: false, error: null }),
}))

const TAG_TYPES = {
  tagTypes: [
    {
      name: 'sport',
      label: 'Sport',
      singleValued: true,
      sort: 1,
      values: [
        { value: 'bike', count: 102 },
        { value: 'hike', count: 23 },
        { value: 'run', count: 70 },
      ],
    },
    {
      name: 'trip',
      label: 'Trip',
      singleValued: true,
      sort: 2,
      values: [{ value: 'Balkan 2026', count: 41 }],
    },
  ],
}

const ACTIVITIES = {
  activities: [
    {
      id: 7,
      source: 'komoot',
      title: 'Orla Perc',
      startedAt: '2025-08-23T05:00:00.000Z',
      utcOffset: 7200,
      localDate: '2025-08-23',
      distanceM: 24_300,
      durationS: 28_800,
      elapsedS: 30_000,
      elevationGainM: 1900,
      speedMs: 0.84,
      tags: ['source:komoot', 'sport:hike'],
    },
  ],
}

const TRACKS = {
  // The wire shape: geometry still encoded, as the map route now sends it.
  tracks: [{ id: 7, polyline: polyline.encode([[49.2, 20.0]]), tags: ['sport:hike'], year: 2025 }],
}

const FACETS = {
  summary: { count: 1, distanceM: 24_300, elevationGainM: 1900, durationS: 28_800 },
  extent: [11.0, 48.0, 12.0, 48.5] as [number, number, number, number],
  tags: [
    {
      type: 'sport',
      values: [
        { value: 'bike', count: 102 },
        { value: 'hike', count: 23 },
        { value: 'run', count: 70 },
      ],
      notSet: 2,
    },
  ],
  ranges: {
    distance: { min: 1000, max: 128_000, buckets: [1, 2, 3] },
    elevation: { min: 0, max: 2900, buckets: [2, 1] },
    duration: { min: 600, max: 30_000, buckets: [1, 1] },
    speed: { min: 0.4, max: 9, buckets: [1, 1] },
  },
}

/** Every request the app makes, and what each one was asked for. */
let requested: string[] = []

function route(url: string): unknown {
  const path = url.split('?')[0]!
  if (path === '/api/tag-types') return TAG_TYPES
  if (path === '/api/activities') return ACTIVITIES
  if (path === '/api/tracks') return TRACKS
  if (path === '/api/facets') return FACETS
  if (path === '/api/tags') return { changed: 1 }
  throw new Error(`unrouted ${url}`)
}

async function renderApp() {
  const { App } = await import('./App.tsx')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App email="rider@example.com" />
    </QueryClientProvider>,
  )
}

describe('the app', () => {
  beforeEach(() => {
    requested = []
    flyTo.mockClear()
    window.history.replaceState(null, '', '/')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init?: RequestInit) => {
        requested.push(`${init?.method ?? 'GET'} ${input}`)
        return new Response(JSON.stringify(route(input)), {
          headers: { 'content-type': 'application/json' },
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts, fetches all four routes and renders what came back', async () => {
    await renderApp()

    await waitFor(() => expect(screen.getByText('Orla Perc')).toBeTruthy())

    // The top bar and the list header both read the same summary, so the count
    // appears exactly twice and can never disagree with itself.
    expect(screen.getAllByText('1 activity')).toHaveLength(2)
    expect(screen.getByText('24 km')).toBeTruthy()
    expect(screen.getByText('1 900 m up')).toBeTruthy()

    // The sidebar renders the registry it was given.
    expect(screen.getByRole('region', { name: 'Sport' })).toBeTruthy()
    expect(screen.getByTestId('track-count').textContent).toBe('1 tracks')

    const paths = requested.map((r) => r.split(' ')[1]!.split('?')[0])
    expect(new Set(paths)).toEqual(
      new Set(['/api/tag-types', '/api/activities', '/api/tracks', '/api/facets']),
    )
  })

  it('writes a sidebar click to the URL and refetches every filtered route', async () => {
    await renderApp()
    await waitFor(() => expect(screen.getByText('Orla Perc')).toBeTruthy())
    requested = []

    await userEvent.click(screen.getByRole('button', { name: /^hike/ }))

    expect(window.location.search).toBe('?tag=sport%3Ahike')
    await waitFor(() => {
      const filtered = requested.filter((r) => r.includes('tag=sport%3Ahike'))
      // Rows, geometry and facets each carry the same filter — three keys, one fact.
      expect(new Set(filtered.map((r) => r.split(' ')[1]!.split('?')[0]))).toEqual(
        new Set(['/api/activities', '/api/tracks', '/api/facets']),
      )
    })
  })

  it('tags what the filter matches, and refetches all four routes', async () => {
    window.history.replaceState(null, '', '/?tag=sport%3Ahike')
    await renderApp()
    await waitFor(() => expect(screen.getByText('Orla Perc')).toBeTruthy())
    requested = []

    await userEvent.type(
      screen.getByRole('textbox', { name: 'type:value' }),
      'trip:Balkan 2026{enter}',
    )

    // The write names its target the way a read does — the same query string, so
    // there is no second way of saying which activities are meant.
    await waitFor(() => expect(requested).toContain('POST /api/tags?tag=sport%3Ahike'))
    const body = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'POST')?.[1]
    expect(JSON.parse(String(body?.body))).toEqual({
      add: ['trip:Balkan 2026'],
      remove: [],
    })

    // The rows carry tags, the map colours by them, the facets count them and the
    // registry is derived from them: everything on screen is downstream of the write.
    await waitFor(() => {
      const paths = new Set(
        requested.filter((r) => r.startsWith('GET ')).map((r) => r.split(' ')[1]!.split('?')[0]),
      )
      expect(paths).toEqual(
        new Set(['/api/tag-types', '/api/activities', '/api/tracks', '/api/facets']),
      )
    })

    // And the result line says what happened, since the rows it touched have usually
    // stopped matching by the time it lands.
    expect(screen.getByText('1 activity tagged · trip:Balkan 2026')).toBeTruthy()
  })

  it('restores the filter from the URL on load, without a click', async () => {
    window.history.replaceState(null, '', '/?tag=sport%3Ahike&distance_min=5000&colour_by=sport')
    await renderApp()

    await waitFor(() => expect(requested.length).toBeGreaterThan(0))
    const activities = requested.find((r) => r.startsWith('GET /api/activities?'))!
    expect(activities).toContain('tag=sport%3Ahike')
    expect(activities).toContain('distance_min=5000')
    // View state is the browser's business and never reaches the server.
    expect(activities).not.toContain('colour_by')
  })

  it('opens the detail panel from the URL, and closes back to the list', async () => {
    window.history.replaceState(null, '', '/?activity=7')
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      requested.push(`GET ${url}`)
      const body =
        url.split('?')[0] === '/api/activities/7'
          ? {
              activity: ACTIVITIES.activities[0],
              track: {
                polyline: polyline.encode([[49.2, 20]], TRACK_PRECISION),
                altitudes: encodeScalars(altitudesToScalars([1500])),
                times: encodeScalars([0]),
              },
            }
          : route(url)
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      })
    })

    await renderApp()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Orla Perc' })).toBeTruthy())
    // The one assertion that the title effect is wired at all — every rung of the
    // ladder itself is exercised in `lib/title.test.tsx`, without rendering.
    expect(document.title).toBe('Orla Perc · Tracks')
    expect(screen.getByText(/1 points at full resolution/)).toBeTruthy()
    // One sampled point is not a profile, and the panel says so rather than drawing
    // a chart of nothing or quietly dropping the group.
    expect(screen.getByText('No elevation recorded')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /All activities/ }))
    expect(window.location.search).toBe('')
    await waitFor(() => expect(document.title).toBe('Tracks'))
  })

  it('surfaces a failed request instead of an empty list', async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      if (String(input).startsWith('/api/activities?')) {
        return new Response(
          JSON.stringify({
            error: 'invalid filter',
            issues: [{ path: 'from', message: 'expected YYYY-MM-DD' }],
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify(route(String(input))), {
        headers: { 'content-type': 'application/json' },
      })
    })

    await renderApp()
    await waitFor(() => expect(screen.getByText(/expected YYYY-MM-DD/)).toBeTruthy())
  })

  it('swaps both panels for the mode, and leaving takes the plan with it', async () => {
    // A shared plan link: two stops, in the fragment, which never reached the server.
    window.history.replaceState(
      null,
      '',
      '/?mode=planning#at=_p~iF~ps%7CU_ulL~ugC&kinds=pp&poi=Vent&poi=Hut',
    )
    await renderApp()

    await waitFor(() => expect(screen.getByText('Vent')).toBeTruthy())
    // Only the right panel follows the mode: the filter sidebar is exactly where it was,
    // still narrowing the tracks a plan is drawn over. Awaited because the plan comes
    // from the fragment and is on screen before the registry has been fetched.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Sport' })).toBeTruthy())
    expect(screen.getByLabelText('Search for a place')).toBeTruthy()
    // Nothing about the plan was ever requested.
    expect(requested.some((r) => r.includes('plan'))).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Activities' }))

    // Leaving is the plan's only Clear control, so the fragment goes with the mode.
    expect(window.location.hash).toBe('')
    await waitFor(() => expect(screen.queryByLabelText('Search for a place')).toBeNull())
    expect(screen.getByRole('region', { name: 'Sport' })).toBeTruthy()
  })

  it('writes a waypoint into the fragment, which is the only place a plan lives', async () => {
    window.history.replaceState(null, '', '/?mode=planning')
    await renderApp()
    await waitFor(() => expect(screen.getByText('Click the map to start')).toBeTruthy())

    // The first two are the start and the end, with no kind toggle at all.
    await userEvent.click(screen.getByRole('button', { name: 'click the map' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))

    await waitFor(() => expect(window.location.hash).toContain('kinds=p'))
    expect(window.location.hash).toContain('at=')
    // The plan is in the fragment and nowhere else: the query string never learns it.
    expect(window.location.search).toBe('?mode=planning')

    await userEvent.click(screen.getByRole('button', { name: 'click the map' }))
    await userEvent.click(await screen.findByRole('button', { name: 'End' }))

    await waitFor(() => expect(window.location.hash).toContain('kinds=pp'))
    // And it round-trips: the list is rendered from what the fragment now says.
    expect(screen.getAllByText('Unnamed stop')).toHaveLength(2)
  })

  it('offers shaping from a click anywhere, not only from a click on the line', async () => {
    window.history.replaceState(null, '', '/?mode=planning')
    await renderApp()
    await waitFor(() => expect(screen.getByText('Click the map to start')).toBeTruthy())

    await userEvent.click(screen.getByRole('button', { name: 'click the map' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))
    await userEvent.click(screen.getByRole('button', { name: 'click elsewhere' }))
    await userEvent.click(await screen.findByRole('button', { name: 'End' }))
    await waitFor(() => expect(window.location.hash).toContain('kinds=pp'))

    // A third click, nowhere near the line — and with the router having said nothing,
    // so there is no routed geometry either. Both were reasons it used to be refused.
    await userEvent.click(screen.getByRole('button', { name: 'click the map' }))

    expect(await screen.findByRole('button', { name: 'Shaping point' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Insert' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Shaping point' }))
    await waitFor(() => expect(window.location.hash).toContain('kinds=prp'))
  })

  it('goes and looks at a searched place when the row is picked', async () => {
    window.history.replaceState(null, '', '/?mode=planning')
    await renderApp()
    await waitFor(() => expect(screen.getByText('Click the map to start')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('Search for a place'), 'Vent')
    await userEvent.click(await screen.findByText('Vent'))

    // The row raises the pinned dialog there — and takes the camera with it, since a
    // dialog pinned off screen is a dialog about nothing you can see.
    expect(flyTo).toHaveBeenCalledWith({ lat: 46.86, lon: 10.91 })
  })

  it('goes and looks at a result the pointer rests on', async () => {
    window.history.replaceState(null, '', '/?mode=planning')
    await renderApp()
    await waitFor(() => expect(screen.getByText('Click the map to start')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('Search for a place'), 'Vent')
    await userEvent.hover(await screen.findByText('Vent'))

    // After a dwell, not immediately — so sweeping down five rows on the way to the
    // fifth does not drag the camera through the first four.
    await waitFor(() => expect(flyTo).toHaveBeenCalledWith({ lat: 46.86, lon: 10.91 }))
  })

  it('does not chase a pointer that passes straight over a result', async () => {
    window.history.replaceState(null, '', '/?mode=planning')
    await renderApp()
    await waitFor(() => expect(screen.getByText('Click the map to start')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('Search for a place'), 'Vent')
    const row = await screen.findByText('Vent')
    await userEvent.hover(row)
    await userEvent.unhover(row)

    // The dwell has not elapsed and the pointer has already left, so nothing moved.
    expect(flyTo).not.toHaveBeenCalled()
  })

  it('goes and looks at one added straight from its row', async () => {
    window.history.replaceState(null, '', '/?mode=planning')
    await renderApp()
    await waitFor(() => expect(screen.getByText('Click the map to start')).toBeTruthy())

    await userEvent.type(screen.getByLabelText('Search for a place'), 'Vent')
    await userEvent.hover(await screen.findByText('Vent'))
    // The inline placement, not the pinned dialog's — no pin has been dropped here.
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    // A stop that appeared somewhere off screen is a stop you have to go and find.
    expect(flyTo).toHaveBeenCalledWith({ lat: 46.86, lon: 10.91 })
    await waitFor(() => expect(window.location.hash).toContain('poi=Vent'))
  })
})
