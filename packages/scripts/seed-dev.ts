/**
 * Fills a local database with activities that never happened.
 *
 *     pnpm db:seed
 *
 * For working on the app without the real data: a contributor cloning this repo, a
 * change to the map or the analytics that wants a few hundred tracks to look at, or an
 * afternoon offline. It writes `data/dev.db`, which `pnpm dev:local` serves.
 *
 * Generated rather than committed as a fixture, because 40 tracks of a few hundred
 * points each is a megabyte of JSON nobody would read in a diff. Deterministic all the
 * same — one seeded generator, so the same command twice gives the same map, and a
 * screenshot in a bug report means something.
 *
 * It goes in through `ingestActivity`, the same path an import uses, so the polyline,
 * the bounding box, the timezone offset and the tag registry are all derived exactly as
 * they are in production rather than approximated here.
 */
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import polyline from '@mapbox/polyline'
import { IMPORT_PRECISION, type ImportFrame } from '@tracks/core'
import { openDb } from '@tracks/server/db.ts'
import { ingestActivity } from '@tracks/server/ingest.ts'
import { writeActivityTags } from '@tracks/server/tagging.ts'
import { sql } from 'drizzle-orm'

/** Mulberry32: three lines, and the same sequence on every machine. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Somewhere plausible to walk, and nowhere anybody actually did. */
const PLACES = [
  { name: 'Vercors', lat: 44.95, lon: 5.45, trip: 'Vercors' },
  { name: 'Cairngorms', lat: 57.08, lon: -3.67, trip: 'Scotland' },
  { name: 'Picos', lat: 43.19, lon: -4.85, trip: 'Picos' },
  { name: 'Rila', lat: 42.13, lon: 23.34, trip: null },
  { name: 'Sarek', lat: 67.3, lon: 17.75, trip: 'Lapland' },
]

const SPORTS = ['hike', 'bike', 'run'] as const
const ACTIVITIES = 60

const roll = random(20260907)

/**
 * A track that wanders rather than jitters.
 *
 * A random walk with momentum: the heading turns a little each step instead of being
 * redrawn, which is the difference between a route and a scribble — and it matters,
 * because the simplifier and the bounding box are what this is here to exercise.
 */
function walk(lat: number, lon: number, points: number) {
  const track: Array<[number, number]> = []
  let heading = roll() * Math.PI * 2
  let [y, x] = [lat, lon]

  for (let i = 0; i < points; i++) {
    heading += (roll() - 0.5) * 0.4
    y += Math.cos(heading) * 0.00018
    x += Math.sin(heading) * 0.00026
    track.push([Number(y.toFixed(6)), Number(x.toFixed(6))])
  }
  return track
}

function frame(index: number): ImportFrame {
  const place = PLACES[index % PLACES.length]!
  const sport = SPORTS[index % SPORTS.length]!
  const points = walk(place.lat + roll() * 0.05, place.lon + roll() * 0.05, 200 + index * 7)

  // Spread over three years so the calendar and the volume trend have something to say.
  const started = new Date(Date.UTC(2023, index % 12, 1 + (index % 27), 7 + (index % 6), 30))
  const seconds = 3600 + Math.round(roll() * 14400)

  return {
    source: index % 3 === 0 ? 'strava' : 'komoot',
    externalId: `dev-${index}`,
    title: `${place.name} ${sport} ${index}`,
    startedAt: started.toISOString(),
    distanceM: points.length * 11 + Math.round(roll() * 2000),
    durationS: seconds,
    elapsedS: seconds + Math.round(roll() * 1800),
    elevationGainM: Math.round(roll() * 1400),
    tags: [`sport:${sport}`],
    geometry: polyline.encode(points, IMPORT_PRECISION),
    altitudes: points.map((_, i) => 600 + Math.round(Math.sin(i / 40) * 400)),
    times: points.map((_, i) => Math.round((i * seconds) / points.length)),
  }
}

const path = resolve(import.meta.dirname, '../../data/dev.db')
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(path + suffix)) rmSync(path + suffix)
}

const { db, close } = await openDb(`file:${path}`, resolve(import.meta.dirname, '../../migrations'))

// Migration 0004 seeds one passwordless account, and everything here lands on it. It
// stays passwordless: `pnpm dev:local` is what claims it, on the way to signing itself
// in, so the sign-in form is not part of development unless you ask for it.
const [user] = await db.all<{ id: number; email: string }>(sql`SELECT id, email FROM users`)
const owner = { userId: user!.id }

for (let i = 0; i < ACTIVITIES; i++) {
  const built = frame(i)
  await ingestActivity(db, owner, built)

  // A trip on some of them, through the same route the detail panel uses, so the
  // registry ends up holding a type it was told about rather than one seeded here.
  const place = PLACES[i % PLACES.length]!
  if (place.trip && i % 2 === 0) {
    const [row] = await db.all<{ id: number }>(
      (await import('drizzle-orm'))
        .sql`SELECT id FROM activities WHERE external_id = ${built.externalId}`,
    )
    await writeActivityTags(db, owner, row!.id, {
      tags: [...built.tags, `source:${built.source}`, `trip:${place.trip}`],
      newType: { name: 'trip', label: 'Trip', singleValued: true },
    })
  }

  process.stdout.write(`\r  ${i + 1} of ${ACTIVITIES}`)
}

console.log(`\n\ndata/dev.db: ${ACTIVITIES} activities for ${user!.email}`)
console.log('`pnpm dev:local` signs in as that account by itself — password: password')
console.log('\n  pnpm dev:local')
close()
