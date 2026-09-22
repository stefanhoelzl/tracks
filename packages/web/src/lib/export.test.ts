import polyline from '@mapbox/polyline'
import {
  type ActivityRow,
  altitudesToScalars,
  emptyFilter,
  encodeScalars,
  TRACK_PRECISION,
} from '@tracks/core'
import { delay, HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { type ExportProgress, exportFileName, exportGpx } from './export.ts'
import { parseTrackBytes } from './gpx-parser.ts'

const row = (id: number, title: string): ActivityRow => ({
  id,
  source: 'strava',
  title,
  startedAt: '2026-09-21T06:14:00Z',
  utcOffset: 7200,
  localDate: '2026-09-21',
  distanceM: 1000,
  durationS: 300,
  elapsedS: 320,
  elevationGainM: 10,
  speedMs: 3.3,
  tags: ['sport:bike'],
})

const ROWS = [row(3, 'Third'), row(1, 'First'), row(2, 'Untracked'), row(4, 'Fourth')]

/** A track for every id but 2, which has none — the server sends three empty strings. */
function track(id: number) {
  if (id === 2) return { polyline: '', altitudes: '', times: '' }
  return {
    polyline: polyline.encode(
      [
        [48 + id / 100, 11],
        [48 + id / 100, 11.001],
      ],
      TRACK_PRECISION,
    ),
    altitudes: encodeScalars(altitudesToScalars([500, 501])),
    times: encodeScalars([0, 5]),
  }
}

/** The list's filter, as the export sent it, so the test can see the viewport went along. */
let listedWith: string | null = null
/** Detail ids that answer 500 instead. */
let failing = new Set<number>()

const server = setupServer(
  http.get('/api/activities', ({ request }) => {
    listedWith = new URL(request.url).search
    return HttpResponse.json({ activities: ROWS })
  }),
  http.get('/api/activities/:id', async ({ params }) => {
    const id = Number(params.id)
    // The first row answers last, so the order in the file cannot be the order of arrival.
    if (id === 3) await delay(20)
    if (failing.has(id)) return HttpResponse.json({ error: 'boom' }, { status: 500 })
    return HttpResponse.json({
      activity: ROWS.find((r) => r.id === id),
      track: track(id),
    })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  listedWith = null
  failing = new Set()
})
afterAll(() => server.close())

const read = async (blob: Blob) =>
  parseTrackBytes('export.gpx', new Uint8Array(await blob.arrayBuffer()))

describe('exportGpx', () => {
  it('writes every listed activity with a track, in the list’s order', async () => {
    const progress: ExportProgress[] = []
    const blob = await exportGpx(
      { ...emptyFilter(), bbox: [11, 48, 12, 49] },
      { signal: new AbortController().signal, onProgress: (p) => progress.push(p) },
    )

    expect(blob.type).toBe('application/gpx+xml')
    const file = await read(blob)
    expect(file.parts.map((part) => part.name)).toEqual(['Third', 'First', 'Fourth'])
    expect(file.parts[0]?.points[1]).toEqual({
      lat: 48.03,
      lon: 11.001,
      altitudeM: 501,
      recordedAt: 1_789_971_245,
    })
    // The viewport is part of the filter, and so part of the export.
    expect(new URLSearchParams(listedWith ?? '').get('bbox')).toBe('11,48,12,49')
    expect(progress.at(0)).toEqual({ done: 0, total: 4 })
    expect(progress.at(-1)).toEqual({ done: 4, total: 4 })
  })

  it('fails as a whole when one activity cannot be read', async () => {
    failing = new Set([4])
    await expect(
      exportGpx(emptyFilter(), { signal: new AbortController().signal, onProgress: () => {} }),
    ).rejects.toThrow('boom')
  })

  it('stops when cancelled', async () => {
    const controller = new AbortController()
    const run = exportGpx(emptyFilter(), {
      signal: controller.signal,
      onProgress: ({ done }) => {
        if (done === 1) controller.abort()
      },
    })
    await expect(run).rejects.toThrow()
  })
})

describe('exportFileName', () => {
  it('is dated by the local calendar', () => {
    expect(exportFileName(new Date(2026, 8, 2, 23, 30))).toBe('tracks-2026-09-02.gpx')
  })
})
