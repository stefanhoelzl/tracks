import polyline from '@mapbox/polyline'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * That the whole app composes, fetches and wires itself together.
 *
 * The map is stubbed rather than rendered: MapLibre needs a WebGL context jsdom does
 * not have, and what is worth asserting here is the wiring — that a filter written by
 * the sidebar reaches the URL, the URL reaches the query keys, and the responses reach
 * the panels. The map's own behaviour is exercised by hand, not here.
 */
vi.mock('./components/MapView.tsx', () => ({
  MapView: (props: { tracks?: { features: unknown[] } }) => (
    <div data-testid="map">{props.tracks?.features.length ?? 0} tracks</div>
  ),
}))

const TAG_TYPES = {
  tagTypes: [
    {
      name: 'sport',
      label: 'Sport',
      enumValues: ['bike', 'hike', 'run'],
      singleValued: true,
      color: '#0A6B48',
      sort: 1,
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
  throw new Error(`unrouted ${url}`)
}

async function renderApp() {
  const { App } = await import('./App.tsx')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

describe('the app', () => {
  beforeEach(() => {
    requested = []
    window.history.replaceState(null, '', '/')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        requested.push(input)
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
    expect(screen.getByTestId('map').textContent).toBe('1 tracks')

    const paths = requested.map((r) => r.split('?')[0])
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
      expect(new Set(filtered.map((r) => r.split('?')[0]))).toEqual(
        new Set(['/api/activities', '/api/tracks', '/api/facets']),
      )
    })
  })

  it('restores the filter from the URL on load, without a click', async () => {
    window.history.replaceState(null, '', '/?tag=sport%3Ahike&distance_min=5000&colour_by=sport')
    await renderApp()

    await waitFor(() => expect(requested.length).toBeGreaterThan(0))
    const activities = requested.find((r) => r.startsWith('/api/activities?'))!
    expect(activities).toContain('tag=sport%3Ahike')
    expect(activities).toContain('distance_min=5000')
    // View state is the browser's business and never reaches the server.
    expect(activities).not.toContain('colour_by')
  })

  it('opens the detail panel from the URL, and closes back to the list', async () => {
    window.history.replaceState(null, '', '/?activity=7')
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input)
      requested.push(url)
      const body =
        url.split('?')[0] === '/api/activities/7'
          ? {
              activity: ACTIVITIES.activities[0],
              track: { polyline: polyline.encode([[49.2, 20]], 6), altitudeM: [1500] },
            }
          : route(url)
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      })
    })

    await renderApp()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Orla Perc' })).toBeTruthy())
    expect(screen.getByText(/1 points at full resolution/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /All activities/ }))
    expect(window.location.search).toBe('')
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
})
