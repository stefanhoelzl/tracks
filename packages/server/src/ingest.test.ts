import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import polyline from '@mapbox/polyline'
import { IMPORT_PRECISION, type ImportFrame } from '@tracks/core'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApi } from './api.ts'
import { openDb, openWriter } from './db.ts'
import { ingest, selectWanted } from './ingest.ts'
import { activities, trackpoints } from './schema.ts'

const MIGRATIONS = resolve(import.meta.dirname, '../../../migrations')

/** A track in the Julian Alps, so the derived offset is a real one. */
const POINTS: Array<[number, number]> = [
  [46.7812, 14.3414],
  [46.7818, 14.3429],
  [46.7825, 14.3441],
  [46.7831, 14.3458],
]

function frame(over: Partial<ImportFrame> = {}): ImportFrame {
  return {
    source: 'komoot',
    externalId: '1000000002',
    title: 'Almenrunde',
    startedAt: '2026-08-20T06:36:58.000Z',
    distanceM: 48210,
    durationS: 8644,
    elapsedS: 11800,
    elevationGainM: 425.13,
    tags: ['sport:hike'],
    geometry: polyline.encode(POINTS, IMPORT_PRECISION),
    altitudes: [594.3, 611, 630.5, 652],
    times: [0, 8, 19, 31],
    ...over,
  }
}

let dir: string
let handle: ReturnType<typeof openDb>

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tracks-ingest-'))
  handle = openDb(join(dir, 'test.db'), MIGRATIONS)
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

async function run(frames: ImportFrame[], signal = new AbortController().signal) {
  const writer = openWriter(handle.path)
  try {
    return await ingest(writer, iterate(frames), () => {}, signal)
  } finally {
    writer.close()
  }
}

async function* iterate<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item
}

const rows = () => handle.db.select().from(activities).all()
const pointCount = () =>
  handle.db.select({ n: sql<number>`count(*)` }).from(trackpoints).get()?.n ?? 0

describe('ingest', () => {
  it('writes an activity, its track and its derived tags', async () => {
    const result = await run([frame()])
    expect(result).toMatchObject({ written: 1, failed: [] })

    const [row] = rows()
    expect(row?.title).toBe('Almenrunde')
    expect(row?.distanceM).toBe(48210)
    // `source:` is the server's derivation, added beside what the source sent.
    expect(JSON.parse(row?.tags ?? '[]')).toEqual(['source:komoot', 'sport:hike'])
    expect(pointCount()).toBe(4)
  })

  it('widens the wire format back out', async () => {
    await run([frame()])
    const points = handle.db.select().from(trackpoints).orderBy(trackpoints.seq).all()

    expect(points[0]?.lat).toBeCloseTo(46.7812, 6)
    expect(points[0]?.altitudeM).toBe(594.3)
    // Times arrive as offsets from the start and are stored as absolute epochs.
    const start = Math.round(Date.parse('2026-08-20T06:36:58.000Z') / 1000)
    expect(points[0]?.recordedAt).toBe(start)
    expect(points[3]?.recordedAt).toBe(start + 31)
  })

  it('keeps a track that carries neither altitude nor timing', async () => {
    await run([frame({ altitudes: null, times: null })])
    const points = handle.db.select().from(trackpoints).all()

    expect(points).toHaveLength(4)
    expect(points.every((p) => p.altitudeM === null && p.recordedAt === null)).toBe(true)
  })

  it('derives the offset from the coordinates, with DST', async () => {
    await run([frame()])
    // The Julian Alps: Europe/Ljubljana, CEST in August.
    expect(rows()[0]?.utcOffset).toBe(7200)
  })

  it('stores a simplified polyline beside the full-resolution points', async () => {
    await run([frame()])
    expect(rows()[0]?.polyline).toBeTruthy()
    // The stored line is the map's; the trackpoints keep every sample.
    expect(pointCount()).toBe(4)
  })

  it('caches the bounding box so the viewport filter never reads the points', async () => {
    await run([frame()])
    const [row] = rows()
    expect(row?.minLat).toBeCloseTo(46.7812, 4)
    expect(row?.maxLon).toBeCloseTo(14.3458, 4)
  })
})

describe('when a frame is bad', () => {
  it('costs itself and nothing else', async () => {
    const result = await run([
      frame(),
      frame({ externalId: 'broken', altitudes: [1, 2] }),
      frame({ externalId: 'other' }),
    ])

    expect(result.written).toBe(2)
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]).toMatchObject({ externalId: 'broken' })
    expect(result.failed[0]?.error).toMatch(/2 entries for 4 points/)
    // The good two still committed: a bad file is not a reason to discard a run.
    expect(rows()).toHaveLength(2)
  })

  it('creates the types it derives, since a fresh database has none', async () => {
    // The registry is empty until something carries a tag: migrations seed no types,
    // and the ones an importer owns come back from the seeds in code.
    expect(handle.sqlite.prepare('select count(*) as n from tag_types').get()).toEqual({ n: 0 })

    const result = await run([frame()])
    expect(result.rejectedTags.size).toBe(0)
    expect(JSON.parse(rows()[0]?.tags ?? '[]')).toEqual(['source:komoot', 'sport:hike'])
    expect(
      handle.sqlite.prepare('select name, label, sort from tag_types order by sort').all(),
    ).toEqual([
      { name: 'sport', label: 'Sport', sort: 1 },
      { name: 'source', label: 'Source', sort: 2 },
    ])
  })

  it('drops a derived tag whose type is not one an importer owns', async () => {
    const result = await run([frame({ tags: ['sport:hike', 'gear:gravel'] })])
    expect(result).toMatchObject({ written: 1, failed: [] })
    expect(result.rejectedTags.get('gear:gravel')).toBe(1)
    expect(JSON.parse(rows()[0]?.tags ?? '[]')).not.toContain('gear:gravel')
  })
})

describe('cancelling', () => {
  it('leaves the database exactly as it was', async () => {
    await run([frame({ externalId: 'first' })])
    const before = handle.sqlite.prepare('select * from activities').all()
    expect(before).toHaveLength(1)

    const controller = new AbortController()
    const writer = openWriter(handle.path)
    try {
      await expect(
        ingest(
          writer,
          iterate([frame({ externalId: 'second' }), frame({ externalId: 'third' })]),
          () => controller.abort(), // cancel the moment the first one lands
          controller.signal,
        ),
      ).rejects.toThrow()
    } finally {
      writer.close()
    }

    // Not "one fewer than it would have been" — byte for byte what it was before.
    expect(handle.sqlite.prepare('select * from activities').all()).toEqual(before)
    expect(pointCount()).toBe(4)
  })

  it('keeps the reader on the pre-import snapshot until the writer commits', async () => {
    const writer = openWriter(handle.path)
    try {
      writer.sqlite.exec('BEGIN IMMEDIATE')
      writer.db
        .insert(activities)
        .values({ source: 'komoot', externalId: 'x', startedAt: '2026-01-01', utcOffset: 0 })
        .run()

      // This is the whole reason the import runs on its own connection: an uncommitted
      // activity must not reach the map, or a rollback would yank it back out again.
      expect(rows()).toHaveLength(0)

      writer.sqlite.exec('COMMIT')
      expect(rows()).toHaveLength(1)
    } finally {
      writer.close()
    }
  })
})

describe('selectWanted', () => {
  it('wants only what has no track yet', async () => {
    await run([frame({ externalId: 'have' })])
    expect(selectWanted(handle.db, 'komoot', ['have', 'missing'])).toEqual(['missing'])
  })

  it('wants a row that exists but was never given a track', async () => {
    handle.db
      .insert(activities)
      .values({ source: 'komoot', externalId: 'empty', startedAt: '2026-01-01', utcOffset: 0 })
      .run()
    // Zero trackpoints means "not imported yet", which is the honest question to ask.
    expect(selectWanted(handle.db, 'komoot', ['empty'])).toEqual(['empty'])
  })

  it('does not confuse one source with another', async () => {
    await run([frame({ externalId: 'shared' })])
    expect(selectWanted(handle.db, 'strava', ['shared'])).toEqual(['shared'])
  })

  it('answers an empty offer with an empty list', () => {
    expect(selectWanted(handle.db, 'komoot', [])).toEqual([])
  })
})

describe('the routes', () => {
  const api = () => createApi(handle.db, handle.path)
  const body = (frames: ImportFrame[]) => frames.map((f) => `${JSON.stringify(f)}\n`).join('')

  const post = (path: string, init: RequestInit) => api().request(path, { method: 'POST', ...init })

  it('selects over HTTP', async () => {
    await run([frame({ externalId: 'have' })])
    const response = await post('/api/import/select', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'komoot', ids: ['have', 'missing'] }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ wanted: ['missing'] })
  })

  it('rejects a malformed selection with the field that broke', async () => {
    const response = await post('/api/import/select', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'komoot' }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid request' })
  })

  it('streams progress and finishes with a summary', async () => {
    const response = await post('/api/import/komoot', {
      headers: { 'content-type': 'application/x-ndjson' },
      body: body([frame({ externalId: 'a' }), frame({ externalId: 'b' })]),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/x-ndjson/)

    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))

    expect(lines.filter((l) => l.type === 'progress')).toHaveLength(2)
    expect(lines.at(-1)).toMatchObject({ type: 'done', written: 2, failed: [] })
    expect(rows()).toHaveLength(2)
  })

  it('reports a malformed frame in the stream, having rolled back', async () => {
    const response = await post('/api/import/komoot', {
      headers: { 'content-type': 'application/x-ndjson' },
      body: `${body([frame()])}{"source":"komoot"}\n`,
    })

    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(lines.at(-1)).toMatchObject({ type: 'error' })
    expect(lines.at(-1).message).toMatch(/malformed frame/)
    // The 200 was already sent, so the failure arrives as a line — and nothing landed.
    expect(rows()).toHaveLength(0)
  })

  it('refuses a second import while one is running', async () => {
    // Hold the first one open by never ending its body, so the lock is genuinely taken.
    let release: () => void = () => {}
    const held = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body([frame()])))
        release = () => controller.close()
      },
    })

    const first = post('/api/import/komoot', {
      headers: { 'content-type': 'application/x-ndjson' },
      body: held,
      duplex: 'half',
    } as RequestInit)

    // Let the first request reach the route and claim the slot.
    await new Promise((r) => setTimeout(r, 50))

    const second = await post('/api/import/strava', {
      headers: { 'content-type': 'application/x-ndjson' },
      body: body([frame()]),
    })
    expect(second.status).toBe(409)
    expect(((await second.json()) as { error: string }).error).toMatch(/komoot is already running/)

    release()
    await (await first).text()
  })
})

describe('the fixtures the browser records', () => {
  it('round-trips a real Komoot tour through the frame format', async () => {
    const tour = JSON.parse(
      readFileSync(
        resolve(import.meta.dirname, '../../../fixtures/komoot/tour-1000000002.json'),
        'utf8',
      ),
    )
    const items = tour._embedded.coordinates.items as Array<{
      lat: number
      lng: number
      alt: number
      t: number
    }>

    await run([
      frame({
        geometry: polyline.encode(
          items.map((i) => [i.lat, i.lng] as [number, number]),
          IMPORT_PRECISION,
        ),
        altitudes: items.map((i) => i.alt),
        times: items.map((i) => Math.round(i.t / 1000)),
      }),
    ])

    expect(pointCount()).toBe(items.length)
    const first = handle.db.select().from(trackpoints).orderBy(trackpoints.seq).all()[0]
    // Precision 6 is lossless, which is the claim the wire format rests on.
    expect(first?.lon).toBeCloseTo(items[0]!.lng, 6)
  })
})
