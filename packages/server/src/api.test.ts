import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import polyline from '@mapbox/polyline'
import type {
  ActivitiesResponse,
  ActivityDetailResponse,
  FacetsResponse,
  TagTypesResponse,
  TracksResponse,
} from '@tracks/core'
import type { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApi } from './api.ts'
import { type Db, openDb } from './db.ts'
import { boundingBox } from './ingest.ts'
import { activities, tagTypes, trackpoints } from './schema.ts'

const MIGRATIONS = resolve(import.meta.dirname, '../../../migrations')

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
async function titles(app: Hono, query: string): Promise<string[]> {
  const response = await app.request(`/api/activities?${query}`)
  expect(response.status).toBe(200)
  const body = (await response.json()) as ActivitiesResponse
  return body.activities.map((a) => a.title!)
}

describe('the REST surface', () => {
  let dir: string
  let db: Db
  let path: string
  let close: () => void
  let app: Hono

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tracks-api-'))
    ;({ db, path, close } = openDb(join(dir, 'test.db'), MIGRATIONS))

    // A type exists exactly as long as something carries a tag of it, so a fresh
    // database has an empty registry and the fixture declares the three these
    // activities use — the way an import and a first hand-applied tag would.
    db.insert(tagTypes)
      .values([
        { name: 'sport', label: 'Sport', singleValued: true, sort: 1 },
        { name: 'trip', label: 'Trip', singleValued: true, sort: 2 },
        { name: 'source', label: 'Source', singleValued: true, sort: 3 },
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

      const id = db
        .insert(activities)
        .values({
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
        .get().id

      db.insert(trackpoints)
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

    app = createApi(db, path)
  })

  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('GET /api/activities', () => {
    it('returns everything, newest first, when nothing is filtered', async () => {
      expect(await titles(app, '')).toEqual([
        'Balkan hike',
        'Night ride',
        'Home run',
        'Alps ride',
        'Untyped',
      ])
    })

    it('ORs values within a tag type and ANDs across types', async () => {
      expect(await titles(app, 'tag=sport:bike')).toEqual(['Night ride', 'Alps ride'])
      expect(await titles(app, 'tag=sport:bike&tag=sport:hike')).toEqual([
        'Balkan hike',
        'Night ride',
        'Alps ride',
      ])
      expect(await titles(app, 'tag=sport:bike&tag=source:komoot')).toEqual([])
    })

    it('reads an empty value as absence, and its negation as presence', async () => {
      expect(await titles(app, 'tag=trip:')).toEqual(['Night ride', 'Home run', 'Untyped'])
      expect(await titles(app, 'tag=-trip:')).toEqual(['Balkan hike', 'Alps ride'])
    })

    it('excludes rather than requires when a term is negated', async () => {
      expect(await titles(app, 'tag=-sport:bike')).toEqual([
        'Balkan hike',
        'Home run',
        'Untyped', // no sport at all still is not a bike
      ])
    })

    it('offers absence alongside values within one type', async () => {
      // "hike, or nothing" — the sidebar's *not set* row selected next to a value.
      expect(await titles(app, 'tag=sport:hike&tag=sport:')).toEqual(['Balkan hike', 'Untyped'])
    })

    it('searches titles, case-insensitively, and never a null one', async () => {
      expect(await titles(app, 'q=balkan')).toEqual(['Balkan hike'])
      expect(await titles(app, 'q=RIDE')).toEqual(['Night ride', 'Alps ride'])
      // The wildcards are characters, not syntax: `%` must not match everything.
      expect(await titles(app, 'q=%')).toEqual([])
    })

    it('narrows with everything else rather than replacing it', async () => {
      expect(await titles(app, 'q=ride&tag=sport:bike')).toEqual(['Night ride', 'Alps ride'])
      expect(await titles(app, 'q=ride&tag=trip:Alps')).toEqual(['Alps ride'])
    })

    it('filters on the local date, not the UTC instant', async () => {
      // The night ride starts at 23:30 UTC on 2024-12-31 and is a 2025 activity.
      expect(await titles(app, 'from=2025-01-01')).toEqual(['Balkan hike', 'Night ride'])
      expect(await titles(app, 'to=2024-12-31')).toEqual(['Home run', 'Alps ride', 'Untyped'])
    })

    it('never matches a range when the metric is missing', async () => {
      // 'Untyped' has no distance, so it is absent from every bounded distance
      // filter — including one whose bounds it would trivially satisfy.
      expect(await titles(app, 'distance_min=0')).not.toContain('Untyped')
      expect(await titles(app, 'distance_max=999999')).not.toContain('Untyped')
      expect(await titles(app, '')).toContain('Untyped')
    })

    it('filters on distance, elevation and duration', async () => {
      expect(await titles(app, 'distance_min=15000&distance_max=50000')).toEqual([
        'Balkan hike',
        'Night ride',
        'Alps ride',
      ])
      expect(await titles(app, 'elevation_min=1000')).toEqual(['Balkan hike', 'Alps ride'])
      expect(await titles(app, 'duration_max=3600')).toEqual(['Night ride', 'Home run'])
    })

    it('derives speed from distance over moving time', async () => {
      expect(await titles(app, 'speed_min=5')).toEqual(['Night ride', 'Alps ride'])
      expect(await titles(app, 'speed_max=1')).toEqual(['Balkan hike'])
    })

    it('matches a bbox against trackpoints, exactly', async () => {
      expect(await titles(app, 'bbox=13.5,46.0,14.0,46.5')).toEqual(['Balkan hike'])
      expect(await titles(app, 'bbox=11.0,48.0,12.0,48.5')).toEqual([
        'Night ride',
        'Home run',
        'Untyped',
      ])
      expect(await titles(app, 'bbox=0,0,1,1')).toEqual([])
    })

    it('sorts by any range key, in either direction', async () => {
      expect(await titles(app, 'sort_key=distance&sort_order=asc')).toEqual([
        'Untyped', // nulls sort first ascending
        'Home run', // 10 km
        'Balkan hike', // 15 km
        'Night ride', // 20 km
        'Alps ride', // 50 km
      ])
      expect(await titles(app, 'sort_key=elevation&sort_order=desc')).toEqual([
        'Balkan hike',
        'Alps ride',
        'Night ride',
        'Home run',
        'Untyped',
      ])
    })

    it('reports a malformed filter as a 400 naming the field', async () => {
      const response = await app.request('/api/activities?from=last-tuesday')
      expect(response.status).toBe(400)

      const body = (await response.json()) as { error: string; issues: Array<{ path: string }> }
      expect(body.error).toBe('invalid filter')
      expect(body.issues[0]!.path).toBe('from')
    })
  })

  describe('GET /api/facets', () => {
    const facets = async (query: string): Promise<FacetsResponse> => {
      const response = await app.request(`/api/facets?${query}`)
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
      const response = await app.request('/api/tracks?tag=sport:hike')
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
      const response = await app.request('/api/tracks?tag=sport:hike')
      const body = (await response.json()) as TracksResponse

      expect(body.tracks[0]!.tags).toEqual(['source:komoot', 'sport:hike', 'trip:Balkan 2026'])
      expect(body.tracks[0]!.year).toBe(2025)
    })

    it('obeys the same filter as the list', async () => {
      const response = await app.request('/api/tracks?bbox=0,0,1,1')
      const body = (await response.json()) as TracksResponse
      expect(body.tracks).toEqual([])
    })
  })

  describe('GET /api/activities/:id', () => {
    it('returns the row plus its full track, in seq order', async () => {
      const list = (await (
        await app.request('/api/activities?tag=sport:hike')
      ).json()) as ActivitiesResponse
      const id = list.activities[0]!.id

      const response = await app.request(`/api/activities/${id}`)
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
      expect((await app.request('/api/activities/99999')).status).toBe(404)
      expect((await app.request('/api/activities/nonsense')).status).toBe(400)
    })
  })

  describe('GET /api/tag-types', () => {
    it('returns the registry in sidebar order, with the values in use', async () => {
      const response = await app.request('/api/tag-types')
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
        await app.request('/api/tag-types?tag=sport:run')
      ).json()) as TagTypesResponse
      expect(body.tagTypes[0]!.values).toContainEqual({ value: 'bike', count: 2 })
    })
  })
})
