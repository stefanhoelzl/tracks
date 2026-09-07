import polyline from '@mapbox/polyline'
import {
  IMPORT_PRECISION,
  type ImportFrame,
  mergeDerivedTags,
  parseTag,
  type TagType,
  validateTag,
} from '@tracks/core'
import { and, eq, sql } from 'drizzle-orm'
import type { Conn, Db } from './db.ts'
import { simplify } from './polyline.ts'
import type { Owner } from './query.ts'
import { createType, loadRegistry, seedFor } from './registry.ts'
import { activities, trackpoints } from './schema.ts'
import { utcOffsetAt } from './timezone.ts'

/**
 * Writing activities the browser read.
 *
 * This is all that is left of the import pipeline server-side, and it knows nothing
 * about Strava or Komoot — `source` is a string it stores and derives one tag from.
 * What it does own is everything the browser cannot: the timezone dataset, the
 * simplifier, the bounding box and the tag registry.
 *
 * **One activity is one transaction.** It used to be one run — a single `BEGIN
 * IMMEDIATE` from the first activity to the last, on a connection of its own, so that
 * cancelling was a `ROLLBACK` rather than an undo log. That assumed one long-lived
 * process, which is exactly what an isolate is not, so the unit of atomicity narrows
 * from the run to the activity.
 *
 * Nothing is lost that the design was not already relying on: `selectWanted` has always
 * reported what has no track yet, so a run that stops half way is resumed by starting it
 * again, and a re-import fetches nothing it already has. What changes is the promise the
 * dialog makes — from "nothing is saved until this finishes" to "what has landed stays".
 */

export interface IngestResult {
  /** Derived tags no registry type could accept, counted by tag. */
  rejectedTags: Map<string, number>
}

/**
 * The track's bounding box, cached onto the activity so the viewport filter never reads
 * its points. One pass rather than `Math.min(...lats)`, which spreads a 34k-point track
 * across the argument limit.
 *
 * Exported because anything that writes trackpoints must write this too — a stale box
 * silently drops the activity out of every viewport filter — so there is one definition
 * of it rather than a copy per writer.
 */
export function boundingBox(points: ReadonlyArray<{ lat: number; lon: number }>) {
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLon = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY

  for (const point of points) {
    if (point.lat < minLat) minLat = point.lat
    if (point.lat > maxLat) maxLat = point.lat
    if (point.lon < minLon) minLon = point.lon
    if (point.lon > maxLon) maxLon = point.lon
  }

  return { minLat, maxLat, minLon, maxLon }
}

/**
 * Accepts the tags a source derived, against the registry.
 *
 * Values are never refused — a source's vocabulary is a fact, and there is no declared
 * one left to be outside of. A *type* is different: nothing says what `gear:` means
 * unless something already does. So a type an importer owns is recreated from its
 * seed, which is what brings `sport` and `source` back after their last activity was
 * deleted, and any other unknown type is dropped and reported. Either way the activity
 * itself imports: a taxonomy question never fails an import.
 */
async function acceptDerived(
  conn: Conn,
  owner: Owner,
  registry: Map<string, TagType>,
  derived: string[],
  result: IngestResult,
) {
  const accepted: string[] = []

  for (const raw of derived) {
    const tag = parseTag(raw)
    const seed = tag && !registry.has(tag.type) ? seedFor(tag.type) : undefined
    if (tag && seed) await createType(conn, owner, registry, { name: tag.type, ...seed })

    if (validateTag(registry, raw) !== null) {
      result.rejectedTags.set(raw, (result.rejectedTags.get(raw) ?? 0) + 1)
      continue
    }
    accepted.push(raw)
  }

  return accepted
}

interface Point {
  lat: number
  lon: number
  altitudeM: number | null
  recordedAt: number | null
}

/**
 * Rebuilds the full-resolution track from the frame.
 *
 * The parallel arrays are the wire's compression, not a shape worth keeping: a track
 * with no elevation sends one `null` instead of 25,000 of them, and times are offsets
 * from the start rather than ten-digit epochs. Both are widened back out here, where
 * `startedAt` is known.
 */
function decodePoints(frame: ImportFrame): Point[] {
  const coordinates = polyline.decode(frame.geometry, IMPORT_PRECISION)
  if (coordinates.length === 0) throw new Error('the frame carries no geometry')

  for (const [name, values] of [
    ['altitudes', frame.altitudes],
    ['times', frame.times],
  ] as const) {
    if (values && values.length !== coordinates.length) {
      throw new Error(`${name} has ${values.length} entries for ${coordinates.length} points`)
    }
  }

  const startEpoch = Math.round(new Date(frame.startedAt).getTime() / 1000)
  if (Number.isNaN(startEpoch)) throw new Error(`'${frame.startedAt}' is not a date`)

  return coordinates.map(([lat, lon], i) => {
    const offset = frame.times?.[i] ?? null
    return {
      lat,
      lon,
      altitudeM: frame.altitudes?.[i] ?? null,
      recordedAt: offset === null ? null : startEpoch + offset,
    }
  })
}

/** Writes one activity, inside the caller's transaction. */
async function write(
  conn: Conn,
  owner: Owner,
  registry: Map<string, TagType>,
  frame: ImportFrame,
  result: IngestResult,
) {
  const points = decodePoints(frame)
  const first = points[0]!

  const existing = await conn
    .select({ id: activities.id, tags: activities.tags })
    .from(activities)
    .where(
      and(
        eq(activities.userId, owner.userId),
        eq(activities.source, frame.source),
        eq(activities.externalId, frame.externalId),
      ),
    )
    .get()

  const row = {
    userId: owner.userId,
    source: frame.source,
    externalId: frame.externalId,
    title: frame.title,
    startedAt: new Date(frame.startedAt).toISOString(),
    utcOffset: utcOffsetAt(first.lat, first.lon, new Date(frame.startedAt)),
    distanceM: frame.distanceM,
    durationS: frame.durationS,
    elapsedS: frame.elapsedS,
    elevationGainM: frame.elevationGainM,
    polyline: polyline.encode(simplify(points).map((p) => [p.lat, p.lon] as [number, number])),
    ...boundingBox(points),
    // `source:` duplicates the column on purpose: the upsert key needs the column, and
    // the tag is what makes source one more facet like any other. Derived here rather
    // than accepted from the frame, so a client cannot send the two disagreeing.
    tags: JSON.stringify(
      mergeDerivedTags(
        existing ? (JSON.parse(existing.tags) as string[]) : [],
        await acceptDerived(
          conn,
          owner,
          registry,
          [...frame.tags, `source:${frame.source}`],
          result,
        ),
      ),
    ),
  }

  let id = existing?.id
  if (id === undefined) {
    id = (await conn.insert(activities).values(row).returning({ id: activities.id }).get()).id
  } else {
    await conn.update(activities).set(row).where(eq(activities.id, id)).run()
    await conn.delete(trackpoints).where(eq(trackpoints.activityId, id)).run()
  }

  // Chunked to stay well under SQLite's variable limit on a 25k-point track.
  for (let i = 0; i < points.length; i += 500) {
    await conn
      .insert(trackpoints)
      .values(
        points.slice(i, i + 500).map((p, j) => ({
          activityId: id,
          seq: i + j,
          lat: p.lat,
          lon: p.lon,
          altitudeM: p.altitudeM,
          recordedAt: p.recordedAt,
        })),
      )
      .run()
  }
}

/**
 * Writes one activity, all of it or none of it.
 *
 * The transaction is drizzle's rather than a hand-written `BEGIN IMMEDIATE`, because
 * there is no longer a lock to take up front: nothing runs for minutes, so nothing needs
 * to refuse a second writer at the start rather than part-way through. An activity and
 * every trackpoint under it commit together, and a frame that cannot be written throws
 * before anything of it is visible.
 */
export function ingestActivity(db: Db, owner: Owner, frame: ImportFrame): Promise<IngestResult> {
  return db.transaction(async (tx) => {
    const result: IngestResult = { rejectedTags: new Map() }
    await write(tx, owner, await loadRegistry(tx, owner), frame, result)
    return result
  })
}

/**
 * Which of these does the database have no track for?
 *
 * Asked by the browser before it reads anything, so a re-import fetches nothing. The
 * client offers its candidates rather than the server publishing every id it holds —
 * and the answer is a pure function of the database, taking no lock and leaving
 * nothing behind, so an abandoned dialog costs exactly nothing.
 *
 * "Has a track", not "exists": zero trackpoints means not imported yet, which is what
 * kept the old pipeline resumable and is still the honest question to ask.
 *
 * Scoped to the asker, so somebody else having ridden the same Komoot tour does not
 * make it one you already have.
 */
export async function selectWanted(
  db: Db,
  owner: Owner,
  source: string,
  ids: string[],
): Promise<string[]> {
  const known = new Set(
    (
      await db
        .select({ externalId: activities.externalId })
        .from(activities)
        .where(
          and(
            eq(activities.userId, owner.userId),
            eq(activities.source, source),
            sql`EXISTS (SELECT 1 FROM trackpoints t WHERE t.activity_id = ${activities.id})`,
          ),
        )
        .all()
    ).map((row) => row.externalId),
  )

  return ids.filter((id) => !known.has(id))
}
