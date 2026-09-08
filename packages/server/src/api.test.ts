import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import polyline from '@mapbox/polyline'
import type {
  ActivitiesResponse,
  ActivityDetailResponse,
  ApiError,
  FacetsResponse,
  TagTypesResponse,
  TracksResponse,
} from '@tracks/core'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApi } from './api.ts'
import { hashPassword, signSession } from './auth.ts'
import type { Db } from './connect.ts'
import { openDb } from './db.ts'
import { boundingBox } from './ingest.ts'
import { activities, tagTypes, trackpoints, users } from './schema.ts'

/** An account that already has a password, so its sessions have a key to be signed with. */
async function claimed(db: Db, email: string, password = 'a good long one') {
  return await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword(password, CHEAP) })
    .returning({ id: users.id, passwordHash: users.passwordHash })
    .get()
}

const MIGRATIONS = resolve(import.meta.dirname, '../../../migrations')

/**
 * A cost nobody would ship. Accounts here are created already claimed, because a
 * session is signed with the signer's own password hash and there is no hash to sign
 * with until one exists — but hashing at the real 600k rounds per test is how a fast
 * suite stops being one. The door's own tests sign in for real.
 */
const CHEAP = 1_000

/**
 * Every request in this file is signed in, because every route in it requires that.
 * The cookie is signed rather than earned through `POST /api/session`, for the same
 * reason the hash is cheap: proving the password path twice costs a second.
 */
type SignedIn = (path: string, init?: RequestInit) => Promise<Response>

/**
 * Five activities chosen to make every rule visible: a null-metric row that no range
 * facet may match, a ride whose UTC instant and local date fall on different years,
 * two sources, two trips, and one activity far enough away to be a bbox of one.
 */
const SEED = [
  {
    title: 'Alps ride',
    source: 'strava',
    startedAt: '2024-06-01T06:00:00.000Z',
    utcOffset: 7200,
    distanceM: 50_000,
    durationS: 7200, // 6.94 m/s
    elapsedS: 8000,
    elevationGainM: 1200,
    tags: ['source:strava', 'sport:bike', 'trip:Alps'],
    at: [46.5, 11.3] as [number, number],
  },
  {
    title: 'Home run',
    source: 'strava',
    startedAt: '2024-06-02T18:00:00.000Z',
    utcOffset: 7200,
    distanceM: 10_000,
    durationS: 3000, // 3.33 m/s
    elapsedS: 3100,
    elevationGainM: 100,
    tags: ['source:strava', 'sport:run'],
    at: [48.13, 11.57] as [number, number],
  },
  {
    // 23:30 UTC on new year's eve is 00:30 local on new year's day.
    title: 'Night ride',
    source: 'strava',
    startedAt: '2024-12-31T23:30:00.000Z',
    utcOffset: 3600,
    distanceM: 20_000,
    durationS: 3600, // 5.56 m/s
    elapsedS: 3700,
    elevationGainM: 300,
    tags: ['source:strava', 'sport:bike'],
    at: [48.14, 11.58] as [number, number],
  },
  {
    title: 'Balkan hike',
    source: 'komoot',
    startedAt: '2025-07-04T05:00:00.000Z',
    utcOffset: 7200,
    distanceM: 15_000,
    durationS: 18_000, // 0.83 m/s
    elapsedS: 20_000,
    elevationGainM: 1800,
    tags: ['source:komoot', 'sport:hike', 'trip:Balkan 2026'],
    at: [46.35, 13.75] as [number, number],
  },
  {
    // The Garmin upload that carried no type, and no metrics either.
    title: 'Untyped',
    source: 'strava',
    startedAt: '2023-03-03T12:00:00.000Z',
    utcOffset: 3600,
    distanceM: null,
    durationS: null,
    elapsedS: null,
    elevationGainM: null,
    tags: ['source:strava'],
    at: [48.15, 11.59] as [number, number],
  },
]

/** Titles rather than ids, so a failure reads as the activities it picked. */
async function titles(signedIn: SignedIn, query: string): Promise<string[]> {
  const response = await signedIn(`/api/activities?${query}`)
  expect(response.status).toBe(200)
  const body = (await response.json()) as ActivitiesResponse
  return body.activities.map((a) => a.title!)
}

describe('the REST surface', () => {
  let dir: string
  let db: Db
  let close: () => void
  let app: ReturnType<typeof createApi>
  let signedIn: SignedIn
  let userId: number
  let hash: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tracks-api-'))
    ;({ db, close } = await openDb(`file:${join(dir, 'test.db')}`, MIGRATIONS))

    const account = await claimed(db, 'rider@example.com')
    userId = account.id
    hash = account.passwordHash!

    // A type exists exactly as long as something carries a tag of it, so a fresh
    // database has an empty registry and the fixture declares the three these
    // activities use — the way an import and a first hand-applied tag would.
    await db
      .insert(tagTypes)
      .values([
        { userId, name: 'sport', label: 'Sport', singleValued: true, sort: 1 },
        { userId, name: 'trip', label: 'Trip', singleValued: true, sort: 2 },
        { userId, name: 'source', label: 'Source', singleValued: true, sort: 3 },
      ])
      .run()

    for (const seed of SEED) {
      const [lat, lon] = seed.at
      // A short track around the activity's own point, so a bbox drawn anywhere
      // near it matches and one drawn elsewhere does not.
      const points = [
        [lat, lon],
        [lat + 0.01, lon + 0.01],
        [lat + 0.02, lon],
      ] as Array<[number, number]>

      const id = (
        await db
          .insert(activities)
          .values({
            userId,
            source: seed.source,
            externalId: seed.title,
            title: seed.title,
            startedAt: seed.startedAt,
            utcOffset: seed.utcOffset,
            distanceM: seed.distanceM,
            durationS: seed.durationS,
            elapsedS: seed.elapsedS,
            elevationGainM: seed.elevationGainM,
            polyline: polyline.encode(points),
            ...boundingBox(points.map(([pLat, pLon]) => ({ lat: pLat, lon: pLon }))),
            tags: JSON.stringify([...seed.tags].sort()),
          })
          .returning({ id: activities.id })
          .get()
      ).id

      await db
        .insert(trackpoints)
        .values(
          points.map((p, seq) => ({
            activityId: id,
            seq,
            lat: p[0],
            lon: p[1],
            altitudeM: 500 + seq,
            recordedAt: 1_700_000_000 + seq,
          })),
        )
        .run()
    }

    app = createApi(db)

    const cookie = `tracks_session=${await signSession(hash, userId, Date.now() + 60_000)}`
    signedIn = async (target, init) =>
      app.request(target, { ...init, headers: { ...init?.headers, cookie } })
  })

  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('GET /api/activities', () => {
    it('returns everything, newest first, when nothing is filtered', async () => {
      expect(await titles(signedIn, '')).toEqual([
        'Balkan hike',
        'Night ride',
        'Home run',
        'Alps ride',
        'Untyped',
      ])
    })

    it('ORs values within a tag type and ANDs across types', async () => {
      expect(await titles(signedIn, 'tag=sport:bike')).toEqual(['Night ride', 'Alps ride'])
      expect(await titles(signedIn, 'tag=sport:bike&tag=sport:hike')).toEqual([
        'Balkan hike',
        'Night ride',
        'Alps ride',
      ])
      expect(await titles(signedIn, 'tag=sport:bike&tag=source:komoot')).toEqual([])
    })

    it('reads an empty value as absence, and its negation as presence', async () => {
      expect(await titles(signedIn, 'tag=trip:')).toEqual(['Night ride', 'Home run', 'Untyped'])
      expect(await titles(signedIn, 'tag=-trip:')).toEqual(['Balkan hike', 'Alps ride'])
    })

    it('excludes rather than requires when a term is negated', async () => {
      expect(await titles(signedIn, 'tag=-sport:bike')).toEqual([
        'Balkan hike',
        'Home run',
        'Untyped', // no sport at all still is not a bike
      ])
    })

    it('offers absence alongside values within one type', async () => {
      // "hike, or nothing" — the sidebar's *not set* row selected next to a value.
      expect(await titles(signedIn, 'tag=sport:hike&tag=sport:')).toEqual([
        'Balkan hike',
        'Untyped',
      ])
    })

    it('searches titles, case-insensitively, and never a null one', async () => {
      expect(await titles(signedIn, 'q=balkan')).toEqual(['Balkan hike'])
      expect(await titles(signedIn, 'q=RIDE')).toEqual(['Night ride', 'Alps ride'])
      // The wildcards are characters, not syntax: `%` must not match everything.
      expect(await titles(signedIn, 'q=%')).toEqual([])
    })

    it('narrows with everything else rather than replacing it', async () => {
      expect(await titles(signedIn, 'q=ride&tag=sport:bike')).toEqual(['Night ride', 'Alps ride'])
      expect(await titles(signedIn, 'q=ride&tag=trip:Alps')).toEqual(['Alps ride'])
    })

    it('filters on the local date, not the UTC instant', async () => {
      // The night ride starts at 23:30 UTC on 2024-12-31 and is a 2025 activity.
      expect(await titles(signedIn, 'from=2025-01-01')).toEqual(['Balkan hike', 'Night ride'])
      expect(await titles(signedIn, 'to=2024-12-31')).toEqual(['Home run', 'Alps ride', 'Untyped'])
    })

    it('never matches a range when the metric is missing', async () => {
      // 'Untyped' has no distance, so it is absent from every bounded distance
      // filter — including one whose bounds it would trivially satisfy.
      expect(await titles(signedIn, 'distance_min=0')).not.toContain('Untyped')
      expect(await titles(signedIn, 'distance_max=999999')).not.toContain('Untyped')
      expect(await titles(signedIn, '')).toContain('Untyped')
    })

    it('filters on distance, elevation and duration', async () => {
      expect(await titles(signedIn, 'distance_min=15000&distance_max=50000')).toEqual([
        'Balkan hike',
        'Night ride',
        'Alps ride',
      ])
      expect(await titles(signedIn, 'elevation_min=1000')).toEqual(['Balkan hike', 'Alps ride'])
      expect(await titles(signedIn, 'duration_max=3600')).toEqual(['Night ride', 'Home run'])
    })

    it('derives speed from distance over moving time', async () => {
      expect(await titles(signedIn, 'speed_min=5')).toEqual(['Night ride', 'Alps ride'])
      expect(await titles(signedIn, 'speed_max=1')).toEqual(['Balkan hike'])
    })

    it('matches a bbox against the cached per-activity box', async () => {
      expect(await titles(signedIn, 'bbox=13.5,46.0,14.0,46.5')).toEqual(['Balkan hike'])
      expect(await titles(signedIn, 'bbox=11.0,48.0,12.0,48.5')).toEqual([
        'Night ride',
        'Home run',
        'Untyped',
      ])
      expect(await titles(signedIn, 'bbox=0,0,1,1')).toEqual([])
    })

    it('excludes an activity whose box overlaps where its track never goes', async () => {
      // The Balkan hike's points are (46.35, 13.75), (46.36, 13.76), (46.37, 13.75), an
      // L whose box covers a bottom-right corner neither a point nor a segment reaches.
      // The cached box alone would report it, which is exactly what the second stage is
      // for — and what a box-only filter costs: fifty activities on a 400 m viewport.
      expect(await titles(signedIn, 'bbox=13.757,46.350,13.760,46.354')).toEqual([])
    })

    it('matches a track that crosses the viewport between two recorded points', async () => {
      // A 200 m box on the diagonal leg, between (46.35, 13.75) and (46.36, 13.76) and
      // containing neither. Segments are what is tested, not the points that bound them,
      // so the crossing counts — which the old point test could not see.
      expect(await titles(signedIn, 'bbox=13.7549,46.3549,13.7551,46.3551')).toEqual([
        'Balkan hike',
      ])
    })

    it('sorts by any range key, in either direction', async () => {
      expect(await titles(signedIn, 'sort_key=distance&sort_order=asc')).toEqual([
        'Untyped', // nulls sort first ascending
        'Home run', // 10 km
        'Balkan hike', // 15 km
        'Night ride', // 20 km
        'Alps ride', // 50 km
      ])
      expect(await titles(signedIn, 'sort_key=elevation&sort_order=desc')).toEqual([
        'Balkan hike',
        'Alps ride',
        'Night ride',
        'Home run',
        'Untyped',
      ])
    })

    it('reports a malformed filter as a 400 naming the field', async () => {
      const response = await signedIn('/api/activities?from=last-tuesday')
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: string; issues: Array<{ path: string }> }
      expect(body.error).toBe('invalid filter')
      expect(body.issues[0]!.path).toBe('from')
    })
  })

  describe('GET /api/facets', () => {
    const facets = async (query: string): Promise<FacetsResponse> => {
      const response = await signedIn(`/api/facets?${query}`)
      expect(response.status).toBe(200)
      return (await response.json()) as FacetsResponse
    }

    const facet = (body: FacetsResponse, type: string) => body.tags.find((t) => t.type === type)!

    it('summarises exactly what the filter selects', async () => {
      const body = await facets('tag=sport:bike')
      expect(body.summary).toEqual({
        count: 2,
        distanceM: 70_000,
        elevationGainM: 1500,
        durationS: 10_800,
      })
    })

    it('counts a tag type without applying that type own terms', async () => {
      // The whole point: picking bike must not zero out hike and run, or the
      // sidebar becomes a dead end you can only leave by clearing.
      const body = await facets('tag=sport:bike')
      expect(facet(body, 'sport').values).toEqual([
        { value: 'bike', count: 2 },
        { value: 'hike', count: 1 },
        { value: 'run', count: 1 },
      ])
    })

    it('still narrows a tag type by every other facet', async () => {
      const body = await facets('tag=sport:bike&source=x&tag=source:komoot')
      // Only the Komoot hike is left, so it is the only sport still worth offering —
      // the source term applies to the sport counts even though the sport terms do not.
      expect(facet(body, 'sport').values).toEqual([{ value: 'hike', count: 1 }])
    })

    it('lists what exists, commonest first', async () => {
      const body = await facets('')
      // No type declares a vocabulary, so every facet is what the data says: two bikes
      // before the single hike and run, and the two trips that anything carries.
      expect(facet(body, 'sport').values).toEqual([
        { value: 'bike', count: 2 },
        { value: 'hike', count: 1 },
        { value: 'run', count: 1 },
      ])
      expect(facet(body, 'trip').values.map((v) => v.value)).toEqual(['Alps', 'Balkan 2026'])
    })

    it('counts activities carrying no tag of a type', async () => {
      const body = await facets('')
      expect(facet(body, 'sport').notSet).toBe(1)
      expect(facet(body, 'trip').notSet).toBe(3)
      expect(facet(body, 'source').notSet).toBe(0)
    })

    it('follows the registry sort order', async () => {
      const body = await facets('')
      expect(body.tags.map((t) => t.type)).toEqual(['sport', 'trip', 'source'])
    })

    it('scales a range axis by other facets but never by its own', async () => {
      const body = await facets('distance_max=10000')

      // Distance keeps its full axis: dragging the distance handle must not move
      // the track it is being dragged along.
      expect(body.ranges.distance.min).toBe(10_000)
      expect(body.ranges.distance.max).toBe(50_000)
      // Elevation does narrow — only the 10 km run survives the distance cap.
      expect(body.ranges.elevation).toMatchObject({ min: 100, max: 100 })
    })

    it('rescales an axis when another facet narrows it', async () => {
      // Self-exclusion is per facet, not global: sport is left out of sport's own
      // counts and out of nothing else, so choosing a sport does rescale distance.
      const body = await facets('tag=sport:hike')
      expect(body.ranges.distance).toMatchObject({ min: 15_000, max: 15_000 })
      expect(body.ranges.distance.buckets).toEqual([1])
    })

    it('buckets a distribution and drops rows with no value', async () => {
      const body = await facets('')
      expect(body.ranges.distance.buckets).toHaveLength(24)
      // Four activities have a distance; 'Untyped' has none and is in no bucket.
      expect(body.ranges.distance.buckets.reduce((a, b) => a + b, 0)).toBe(4)
      expect(body.ranges.speed.buckets.reduce((a, b) => a + b, 0)).toBe(4)
    })

    it('has no axis at all when nothing in scope has a value', async () => {
      const body = await facets('tag=sport:')
      expect(body.ranges.distance).toEqual({ min: null, max: null, buckets: [] })
    })
  })

  describe('GET /api/tracks', () => {
    it('hands over the stored polyline, still encoded', async () => {
      const response = await signedIn('/api/tracks?tag=sport:hike')
      expect(response.status).toBe(200)

      const body = (await response.json()) as TracksResponse
      expect(body.tracks).toHaveLength(1)

      // Encoded [lat, lon] pairs, exactly as the column holds them. Flipping to the
      // longitude-first order GeoJSON wants is the browser's job now.
      const [lat, lon] = polyline.decode(body.tracks[0]!.polyline)[0]!
      expect(lat).toBeCloseTo(46.35, 4)
      expect(lon).toBeCloseTo(13.75, 4)
    })

    it('carries the tags and year that colour-by paints from', async () => {
      const response = await signedIn('/api/tracks?tag=sport:hike')
      const body = (await response.json()) as TracksResponse

      expect(body.tracks[0]!.tags).toEqual(['source:komoot', 'sport:hike', 'trip:Balkan 2026'])
      expect(body.tracks[0]!.year).toBe(2025)
    })

    it('obeys the same filter as the list', async () => {
      const response = await signedIn('/api/tracks?bbox=0,0,1,1')
      const body = (await response.json()) as TracksResponse
      expect(body.tracks).toEqual([])
    })
  })

  describe('GET /api/activities/:id', () => {
    it('returns the row plus its full track, in seq order', async () => {
      const list = (await (
        await signedIn('/api/activities?tag=sport:hike')
      ).json()) as ActivitiesResponse
      const id = list.activities[0]!.id

      const response = await signedIn(`/api/activities/${id}`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as ActivityDetailResponse
      expect(body.activity.title).toBe('Balkan hike')
      expect(body.activity.localDate).toBe('2025-07-04')
      expect(body.activity.speedMs).toBeCloseTo(15_000 / 18_000, 6)

      // Precision 6 round-trips the fixture exactly, so this asserts equality rather
      // than closeness — a lossy encoding would show up here.
      expect(polyline.decode(body.track.polyline, 6)).toEqual([
        [46.35, 13.75],
        [46.36, 13.76],
        [46.37, 13.75],
      ])
      // Altitude is a parallel array, aligned with the points by index.
      expect(body.track.altitudeM).toEqual([500, 501, 502])
    })

    it('is a 404 for an activity that is not there, and a 400 for one that cannot be', async () => {
      expect((await signedIn('/api/activities/99999')).status).toBe(404)
      expect((await signedIn('/api/activities/nonsense')).status).toBe(400)
    })
  })

  describe('POST /api/tags', () => {
    const post = (query: string, body: unknown) =>
      signedIn(`/api/tags?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const tagsOf = async (title: string) =>
      JSON.parse(
        (
          (await db.get<{ tags: string }>(
            sql`SELECT tags FROM activities WHERE title = ${title}`,
          )) as {
            tags: string
          }
        ).tags,
      ) as string[]

    it('applies to everything the filter matches, and counts what changed', async () => {
      const response = await post('tag=sport:bike', { add: ['trip:Alps'] })
      expect(response.status).toBe(200)
      // Two bikes match; one already carries the trip, so only the other gained it.
      expect(await response.json()).toEqual({ changed: 1 })
      expect(await tagsOf('Night ride')).toContain('trip:Alps')
      expect(await tagsOf('Home run')).not.toContain('trip:Alps')
    })

    it('replaces silently on a single-valued type', async () => {
      await post('tag=trip:Balkan 2026', { add: ['trip:Balkans'] })
      // The old trip is gone rather than sitting beside the new one — which is what
      // makes a rename one bulk add.
      expect(await tagsOf('Balkan hike')).toEqual(['source:komoot', 'sport:hike', 'trip:Balkans'])
    })

    it('removes over the filter, and takes the type with the last tag of it', async () => {
      const response = await post('', { remove: ['trip:Alps', 'trip:Balkan 2026'] })
      expect(await response.json()).toEqual({ changed: 2 })

      const types = (await (await signedIn('/api/tag-types')).json()) as TagTypesResponse
      // Nothing carries a trip any more, so there is no Trip: the registry describes
      // the data rather than outliving it.
      expect(types.tagTypes.map((t) => t.name)).toEqual(['sport', 'source'])
    })

    it('creates a type and applies its first tag in one request', async () => {
      const response = await post('tag=sport:run', {
        add: ['gear:steel'],
        newType: { name: 'gear', label: 'Gear', singleValued: false },
      })
      expect(await response.json()).toEqual({ changed: 1 })

      const types = (await (await signedIn('/api/tag-types')).json()) as TagTypesResponse
      expect(types.tagTypes.at(-1)).toMatchObject({
        name: 'gear',
        label: 'Gear',
        singleValued: false,
        values: [{ value: 'steel', count: 1 }],
      })
    })

    it('refuses a tag whose type nothing declared, and writes nothing', async () => {
      const response = await post('', { add: ['gear:steel'] })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: "no tag type 'gear'" })
      expect(await tagsOf('Alps ride')).toEqual(['source:strava', 'sport:bike', 'trip:Alps'])
    })

    it('reports a malformed filter and a malformed body apart', async () => {
      expect(((await (await post('from=nonsense', { add: [] })).json()) as ApiError).error).toBe(
        'invalid filter',
      )
      expect(((await (await post('', { add: 'trip:Alps' })).json()) as ApiError).error).toBe(
        'invalid request',
      )
    })
  })

  describe('PUT /api/activities/:id/tags', () => {
    const idOf = async (title: string) =>
      (await db.get<{ id: number }>(sql`SELECT id FROM activities WHERE title = ${title}`))!.id

    const put = (id: number, body: unknown) =>
      signedIn(`/api/activities/${id}/tags`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    it('replaces the array wholesale, sorted', async () => {
      const response = await put(await idOf('Home run'), {
        tags: ['trip:Alps', 'source:strava', 'sport:run'],
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        tags: ['source:strava', 'sport:run', 'trip:Alps'],
      })
    })

    it('creates a type alongside the tag that needs it', async () => {
      const response = await put(await idOf('Untyped'), {
        tags: ['source:strava', 'gear:steel'],
        newType: { name: 'gear', label: 'Gear', singleValued: false },
      })
      expect(await response.json()).toEqual({ tags: ['gear:steel', 'source:strava'] })
    })

    it('is a 404 for an activity that is not there, and a 400 for a bad tag', async () => {
      expect((await put(99999, { tags: [] })).status).toBe(404)
      expect((await put(await idOf('Home run'), { tags: ['nonsense'] })).status).toBe(400)
    })
  })

  describe('GET /api/tag-types', () => {
    it('returns the registry in sidebar order, with the values in use', async () => {
      const response = await signedIn('/api/tag-types')
      expect(response.status).toBe(200)

      const body = (await response.json()) as TagTypesResponse
      expect(body.tagTypes.map((t) => t.name)).toEqual(['sport', 'trip', 'source'])
      expect(body.tagTypes[0]!.singleValued).toBe(true)
      // Commonest first, and counted over every activity — the autocomplete has to
      // offer a value precisely when the filter has narrowed away from it.
      expect(body.tagTypes[0]!.values).toEqual([
        { value: 'bike', count: 2 },
        { value: 'hike', count: 1 },
        { value: 'run', count: 1 },
      ])
      expect(body.tagTypes[1]!.values.map((v) => v.value).sort()).toEqual(['Alps', 'Balkan 2026'])
    })

    it('counts the whole archive, not the filter', async () => {
      // No filter is even accepted here: the route takes none, and the vocabulary it
      // returns is the same one whatever the sidebar is currently showing.
      const body = (await (
        await signedIn('/api/tag-types?tag=sport:run')
      ).json()) as TagTypesResponse
      expect(body.tagTypes[0]!.values).toContainEqual({ value: 'bike', count: 2 })
    })
  })

  /**
   * The half of multi-tenancy no filter can express.
   *
   * A second account with one activity of its own, asked for through the first
   * account's cookie. Every route is here, because the interesting failures are not
   * "the scope was wrong" but "this one route never had a scope" — the by-id ones,
   * which take an id and, before M6, nothing else.
   */
  describe("somebody else's activities", () => {
    let theirId: number

    beforeEach(async () => {
      const them = (await claimed(db, 'stranger@example.com')).id

      await db
        .insert(tagTypes)
        .values({ userId: them, name: 'sport', label: 'Sport', singleValued: true, sort: 1 })
        .run()

      theirId = (
        await db
          .insert(activities)
          .values({
            userId: them,
            source: 'strava',
            externalId: 'theirs',
            title: 'Not yours',
            startedAt: '2024-06-01T08:00:00.000Z',
            utcOffset: 7200,
            distanceM: 12000,
            durationS: 3600,
            elapsedS: 3600,
            elevationGainM: 100,
            polyline: polyline.encode([
              [48.15, 11.59],
              [48.16, 11.6],
            ]),
            ...boundingBox([
              { lat: 48.15, lon: 11.59 },
              { lat: 48.16, lon: 11.6 },
            ]),
            tags: JSON.stringify(['source:strava', 'sport:ski']),
          })
          .returning({ id: activities.id })
          .get()
      ).id

      await db
        .insert(trackpoints)
        .values([
          { activityId: theirId, seq: 0, lat: 48.15, lon: 11.59 },
          { activityId: theirId, seq: 1, lat: 48.16, lon: 11.6 },
        ])
        .run()
    })

    it('are not in the list, the tracks or the totals', async () => {
      expect(await titles(signedIn, '')).not.toContain('Not yours')

      const tracks = (await (await signedIn('/api/tracks')).json()) as TracksResponse
      expect(tracks.tracks.map((t) => t.id)).not.toContain(theirId)

      const facets = (await (await signedIn('/api/facets')).json()) as FacetsResponse
      expect(facets.summary.count).toBe(SEED.length)
    })

    it('are not reachable by id, and say the same as an id that does not exist', async () => {
      const theirs = await signedIn(`/api/activities/${theirId}`)
      const nobody = await signedIn('/api/activities/99999')

      // Answered as if nothing were there — the same status and the same sentence an
      // unused id gets, so a 404 never tells you that something exists but is not yours.
      expect(theirs.status).toBe(nobody.status)
      expect(theirs.status).toBe(404)
      expect(await theirs.json()).toEqual({ error: `no activity ${theirId}` })
    })

    it('cannot be tagged by id', async () => {
      const response = await signedIn(`/api/activities/${theirId}/tags`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags: ['sport:bike'] }),
      })

      expect(response.status).toBe(404)
      const after = await db.get<{ tags: string }>(
        sql`SELECT tags FROM activities WHERE id = ${theirId}`,
      )
      expect(JSON.parse(after!.tags)).toContain('sport:ski')
    })

    it('cannot be tagged by a filter that would otherwise match them', async () => {
      // An empty filter means "everything", and this is what everything means now.
      const response = await signedIn('/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ add: ['trip:Mine'] }),
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ changed: SEED.length })
      const after = await db.get<{ tags: string }>(
        sql`SELECT tags FROM activities WHERE id = ${theirId}`,
      )
      expect(JSON.parse(after!.tags)).not.toContain('trip:Mine')
    })

    it('do not appear in the vocabulary, even under a type name shared with them', async () => {
      const body = (await (await signedIn('/api/tag-types')).json()) as TagTypesResponse
      const sport = body.tagTypes.find((t) => t.name === 'sport')!
      expect(sport.values.map((v) => v.value)).not.toContain('ski')
    })

    it('keeps their registry when the last of your tags of a shared type goes', async () => {
      // Type GC is a DELETE over a table two people now share. Emptying `sport` here
      // must not empty theirs, or one person untagging deletes another's sidebar.
      const response = await signedIn('/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remove: ['sport:bike', 'sport:hike', 'sport:run'] }),
      })
      expect(response.status).toBe(200)

      const mine = (await (await signedIn('/api/tag-types')).json()) as TagTypesResponse
      expect(mine.tagTypes.map((t) => t.name)).not.toContain('sport')
      expect(
        (await db.get<{ n: number }>(
          sql`SELECT count(*) AS n FROM tag_types WHERE name = 'sport'`,
        ))!.n,
      ).toBe(1)
    })
  })

  describe('the door', () => {
    const signIn = (body: unknown) =>
      app.request('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    it('forbids caching anywhere under /api, whatever answers', async () => {
      // Not staleness — safety. These responses are scoped to whoever asked, so a
      // cache keyed on the URL would serve one person's activities to the next.
      for (const [route, init] of [
        ['/api/activities', undefined],
        ['/api/tag-types', undefined],
        ['/api/session', undefined],
        ['/api/session', { method: 'DELETE' }],
      ] as const) {
        const response = await signedIn(route, init)
        expect(response.headers.get('cache-control')).toBe('no-store')
      }

      // Including the ones nobody is signed in for.
      expect((await app.request('/api/activities')).headers.get('cache-control')).toBe('no-store')
    })

    it('refuses every route without a cookie', async () => {
      for (const route of [
        '/api/activities',
        '/api/tracks',
        '/api/facets',
        '/api/tag-types',
        `/api/activities/${1}`,
      ]) {
        expect((await app.request(route)).status).toBe(401)
      }
    })

    it("refuses a cookie signed with a key that is not that user's", async () => {
      const forged = `tracks_session=${await signSession('some other hash', userId, Date.now() + 1000)}`
      const response = await app.request('/api/activities', { headers: { cookie: forged } })
      expect(response.status).toBe(401)
    })

    it("ends every session of a user whose password changes, and nobody else's", async () => {
      // The whole of revocation: the key those cookies were signed with was the old
      // hash, and it no longer exists. No sessions table, and no reach into anyone else.
      const theirs = await claimed(db, 'stranger@example.com')
      const theirCookie = `tracks_session=${await signSession(theirs.passwordHash!, theirs.id, Date.now() + 60_000)}`
      expect(
        (await app.request('/api/activities', { headers: { cookie: theirCookie } })).status,
      ).toBe(200)

      await db
        .update(users)
        .set({ passwordHash: await hashPassword('a different one', CHEAP) })
        .where(eq(users.id, userId))
        .run()

      expect((await signedIn('/api/activities')).status).toBe(401)
      expect(
        (await app.request('/api/activities', { headers: { cookie: theirCookie } })).status,
      ).toBe(200)
    })

    it('ends them when the password is cleared, which is how an account is handed back', async () => {
      await db.update(users).set({ passwordHash: null }).where(eq(users.id, userId)).run()
      expect((await signedIn('/api/activities')).status).toBe(401)
    })

    it('claims a passwordless account on its first sign-in, and holds it after', async () => {
      const first = await signIn({ email: 'rider@example.com', password: 'a good long one' })
      expect(first.status).toBe(200)
      expect(await first.json()).toEqual({ email: 'rider@example.com' })
      expect(first.headers.get('set-cookie')).toMatch(/tracks_session=/)
      expect(first.headers.get('set-cookie')).toMatch(/HttpOnly/)

      // The second sign-in is a verification, not a second claim: the password set by
      // the first is now the password, and a different one no longer takes the account.
      expect(
        (await signIn({ email: 'rider@example.com', password: 'a good long one' })).status,
      ).toBe(200)
      expect(
        (await signIn({ email: 'rider@example.com', password: 'something else' })).status,
      ).toBe(401)
    })

    it('says the same thing to a wrong password and an address with no account', async () => {
      // Claimed first: until it is, every password is the right one by design.
      await signIn({ email: 'rider@example.com', password: 'a good long one' })

      const wrong = await signIn({ email: 'rider@example.com', password: 'wrong password' })
      const unknown = await signIn({ email: 'nobody@example.com', password: 'wrong password' })

      expect(wrong.status).toBe(401)
      expect(unknown.status).toBe(401)
      expect(await wrong.json()).toEqual(await unknown.json())
    })

    it('lets a signed-in request say who it is, and a signed-out one say nothing', async () => {
      expect((await app.request('/api/session')).status).toBe(401)

      const response = await signedIn('/api/session')
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ email: 'rider@example.com' })
    })

    it('sets a Lax cookie, and a framed one only when asked', async () => {
      const credentials = { email: 'rider@example.com', password: 'a good long one' }
      const lax = (await signIn(credentials)).headers.get('set-cookie')!
      expect(lax).toMatch(/SameSite=Lax/)
      expect(lax).not.toMatch(/Secure/)

      // What the dev server sets so the Simple Browser, which frames the page, keeps
      // it at all. `None` without `Secure` is a cookie no browser stores.
      const framed = createApi(db, { crossSite: true })
      const response = await framed.request('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      const cookie = response.headers.get('set-cookie')!
      expect(cookie).toMatch(/SameSite=None/)
      expect(cookie).toMatch(/Secure/)
    })

    it('clears the cookie on the way out', async () => {
      const response = await signedIn('/api/session', { method: 'DELETE' })
      expect(response.status).toBe(204)
      expect(response.headers.get('set-cookie')).toMatch(/tracks_session=;/)
    })

    it('clears it with the attributes it was set with, or it is not cleared at all', async () => {
      // A framed page rejects any Set-Cookie that is not `None; Secure` — the one that
      // ends the session included. Sent as Lax, sign-out returns 204 and changes
      // nothing, which is the most confusing shape a bug can take.
      const framed = createApi(db, { crossSite: true })
      const response = await framed.request('/api/session', { method: 'DELETE' })

      const cookie = response.headers.get('set-cookie')!
      expect(cookie).toMatch(/tracks_session=;/)
      expect(cookie).toMatch(/SameSite=None/)
      expect(cookie).toMatch(/Secure/)
    })
  })
})
