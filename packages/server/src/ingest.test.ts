import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import polyline from '@mapbox/polyline'
import {
  altitudesFromScalars,
  decodeScalars,
  IMPORT_PRECISION,
  type ImportFrame,
  TRACK_PRECISION,
} from '@tracks/core'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApi } from './api.ts'
import { hashPassword, signSession } from './auth.ts'
import { openDb } from './db.ts'
import { ingestActivity, selectWanted } from './ingest.ts'
import type { Owner } from './query.ts'
import { activities, users } from './schema.ts'

const MIGRATIONS = resolve(import.meta.dirname, '../../../migrations')

/** Cheap on purpose — nothing here is about how long hashing takes. */
const CHEAP = 1_000

/** Whose import this is. One account, made fresh with the database, already claimed. */
let owner: Owner
let hash: string

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
let handle: Awaited<ReturnType<typeof openDb>>

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'tracks-ingest-'))
  handle = await openDb(`file:${join(dir, 'test.db')}`, MIGRATIONS)

  hash = await hashPassword('a good long one', CHEAP)
  const account = await handle.db
    .insert(users)
    .values({ email: 'rider@example.com', passwordHash: hash })
    .returning({ id: users.id })
    .get()
  owner = { userId: account.id }
})
afterEach(() => {
  handle.close()
  rmSync(dir, { recursive: true, force: true })
})

/**
 * What the browser's loop does, in one function: each activity on its own, a failure
 * costing itself, and the run carrying on past it.
 */
async function run(frames: ImportFrame[]) {
  const written: number[] = []
  const failed: Array<{ externalId: string; error: string }> = []
  const rejectedTags = new Map<string, number>()

  for (const frame of frames) {
    try {
      for (const [tag, n] of (await ingestActivity(handle.db, owner, frame)).rejectedTags) {
        rejectedTags.set(tag, (rejectedTags.get(tag) ?? 0) + n)
      }
      written.push(1)
    } catch (error) {
      failed.push({
        externalId: frame.externalId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { written: written.length, failed, rejectedTags }
}

const rows = () => handle.db.select().from(activities).all()
/** The stored track, decoded back into the arrays the frame carried. */
const storedTrack = async () => {
  const [row] = await rows()
  if (!row?.trackGeometry) return null
  return {
    coordinates: polyline.decode(row.trackGeometry, TRACK_PRECISION),
    altitudeM: altitudesFromScalars(decodeScalars(row.trackAltitudes ?? '')),
    secondsFromStart: decodeScalars(row.trackTimes ?? ''),
  }
}

const pointCount = async () => (await storedTrack())?.coordinates.length ?? 0

describe('ingest', () => {
  it('writes an activity, its track and its derived tags', async () => {
    const result = await run([frame()])
    expect(result).toMatchObject({ written: 1, failed: [] })

    const [row] = await rows()
    expect(row?.title).toBe('Almenrunde')
    expect(row?.distanceM).toBe(48210)
    // `source:` is the server's derivation, added beside what the source sent.
    expect(JSON.parse(row?.tags ?? '[]')).toEqual(['source:komoot', 'sport:hike'])
    expect(await pointCount()).toBe(4)
  })

  it('stores the wire format as the wire format', async () => {
    await run([frame()])
    const track = await storedTrack()

    expect(track?.coordinates[0]?.[0]).toBeCloseTo(46.7812, 6)
    expect(track?.altitudeM[0]).toBe(594.3)
    // Times stay offsets from the start, which is what the frame sends and what
    // `started_at` already lets anything reconstruct an epoch from.
    expect(track?.secondsFromStart[0]).toBe(0)
    expect(track?.secondsFromStart[3]).toBe(31)
  })

  it('keeps a track that carries neither altitude nor timing', async () => {
    await run([frame({ altitudes: null, times: null })])
    const track = await storedTrack()

    expect(track?.coordinates).toHaveLength(4)
    // Absent for every point, and absent one character at a time rather than by the
    // column being null — which is reserved for an activity with no track at all.
    expect(track?.altitudeM.every((v) => v === null)).toBe(true)
    expect(track?.secondsFromStart.every((v) => v === null)).toBe(true)
  })

  it('derives the offset from the coordinates, with DST', async () => {
    await run([frame()])
    // The Julian Alps: Europe/Ljubljana, CEST in August.
    expect((await rows())[0]?.utcOffset).toBe(7200)
  })

  it('stores a simplified polyline beside the full-resolution points', async () => {
    await run([frame()])
    expect((await rows())[0]?.polyline).toBeTruthy()
    // The stored line is the map's; `track_geometry` keeps every sample.
    expect(await pointCount()).toBe(4)
  })

  it('caches the bounding box so the viewport filter never reads the points', async () => {
    await run([frame()])
    const [row] = await rows()
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
    expect(await rows()).toHaveLength(2)
  })

  it('creates the types it derives, since a fresh database has none', async () => {
    // The registry is empty until something carries a tag: migrations seed no types,
    // and the ones an importer owns come back from the seeds in code.
    expect(await handle.db.get(sql`select count(*) as n from tag_types`)).toEqual({ n: 0 })

    const result = await run([frame()])
    expect(result.rejectedTags.size).toBe(0)
    expect(JSON.parse((await rows())[0]?.tags ?? '[]')).toEqual(['source:komoot', 'sport:hike'])
    expect(await handle.db.all(sql`select name, label, sort from tag_types order by sort`)).toEqual(
      [
        { name: 'sport', label: 'Sport', sort: 1 },
        { name: 'source', label: 'Source', sort: 2 },
      ],
    )
  })

  it('drops a derived tag whose type is not one an importer owns', async () => {
    const result = await run([frame({ tags: ['sport:hike', 'gear:gravel'] })])
    expect(result).toMatchObject({ written: 1, failed: [] })
    expect(result.rejectedTags.get('gear:gravel')).toBe(1)
    expect(JSON.parse((await rows())[0]?.tags ?? '[]')).not.toContain('gear:gravel')
  })
})

describe('stopping half way', () => {
  it('keeps what landed, and select reports the rest', async () => {
    // The promise the dialog now makes. It used to be the opposite — one transaction
    // for the whole run, so cancelling left the database byte for byte as it was — and
    // that could not survive an isolate, where nothing lives between requests.
    await run([frame({ externalId: 'first' })])

    expect(await rows()).toHaveLength(1)
    // Which is only tolerable because resuming was already free: `select` has always
    // answered with what has no track yet, so the next run continues rather than repeats.
    expect(await selectWanted(handle.db, owner, 'komoot', ['first', 'second'])).toEqual(['second'])
  })

  it('writes an activity and its points together, or neither', async () => {
    // Atomicity did not go away, it narrowed. A frame that cannot be decoded leaves no
    // half-written activity behind for the next run to find and skip.
    const result = await run([frame({ externalId: 'broken', altitudes: [1, 2] })])

    expect(result.failed).toHaveLength(1)
    expect(await rows()).toHaveLength(0)
    expect(await pointCount()).toBe(0)
  })
})

describe('selectWanted', () => {
  it('wants only what has no track yet', async () => {
    await run([frame({ externalId: 'have' })])
    expect(await selectWanted(handle.db, owner, 'komoot', ['have', 'missing'])).toEqual(['missing'])
  })

  it('wants a row that exists but was never given a track', async () => {
    await handle.db
      .insert(activities)
      .values({
        ...owner,
        source: 'komoot',
        externalId: 'empty',
        startedAt: '2026-01-01',
        utcOffset: 0,
      })
      .run()
    // No geometry means "not imported yet", which is the honest question to ask.
    expect(await selectWanted(handle.db, owner, 'komoot', ['empty'])).toEqual(['empty'])
  })

  it('does not confuse one source with another', async () => {
    await run([frame({ externalId: 'shared' })])
    expect(await selectWanted(handle.db, owner, 'strava', ['shared'])).toEqual(['shared'])
  })

  it('answers an empty offer with an empty list', async () => {
    expect(await selectWanted(handle.db, owner, 'komoot', [])).toEqual([])
  })
})

describe('the routes', () => {
  const api = () => createApi(handle.db)

  // The routes are behind the cookie like everything else under /api, so the import
  // tests carry one — signed rather than earned, for the reason api.test.ts gives.
  const post = async (path: string, init: RequestInit) =>
    api().request(path, {
      method: 'POST',
      ...init,
      headers: {
        ...init.headers,
        cookie: `tracks_session=${await signSession(hash, owner.userId, Date.now() + 60_000)}`,
      },
    })

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

  it('writes one activity and answers with what it could not tag', async () => {
    const response = await post('/api/import', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(frame({ tags: ['sport:hike', 'gear:gravel'] })),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ rejectedTags: [['gear:gravel', 1]] })
    expect(await rows()).toHaveLength(1)
  })

  it('refuses one bad activity with a 400, and writes nothing of it', async () => {
    const response = await post('/api/import', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(frame({ altitudes: [1, 2] })),
    })

    // The browser records this against that activity and moves to the next one; there
    // is no run left for it to fail. Where the old route had to report a bad frame as a
    // line in a stream it had already committed to, this is just a status code.
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/2 entries for 4 points/),
    })
    expect(await rows()).toHaveLength(0)
  })

  it('rejects a body that is not a frame with the field that broke', async () => {
    const response = await post('/api/import', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'komoot' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'invalid request' })
  })

  it('takes two imports at once, because there is nothing left to serialise', async () => {
    // The module-level lock is gone with the transaction it guarded. Two tabs importing
    // is wasteful, not corrupting: the writes are idempotent and the unique key refuses
    // a duplicate.
    const [first, second] = await Promise.all([
      post('/api/import', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(frame({ externalId: 'a' })),
      }),
      post('/api/import', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(frame({ externalId: 'b' })),
      }),
    ])

    expect([first.status, second.status]).toEqual([200, 200])
    expect(await rows()).toHaveLength(2)
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

    expect(await pointCount()).toBe(items.length)

    // Precision 6 and a tenth of a metre are the claims the stored format rests on, so
    // this checks every point rather than the first: half a unit in the last place is
    // 5.6cm of coordinate and 5cm of altitude, against a receiver with 1-3m of error.
    const track = await storedTrack()
    for (const [i, item] of items.entries()) {
      expect(track?.coordinates[i]?.[0]).toBeCloseTo(item.lat, 6)
      expect(track?.coordinates[i]?.[1]).toBeCloseTo(item.lng, 6)
      expect(track?.altitudeM[i]).toBeCloseTo(item.alt, 1)
      expect(track?.secondsFromStart[i]).toBe(Math.round(item.t / 1000))
    }
  })
})
