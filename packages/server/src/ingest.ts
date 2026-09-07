import polyline from '@mapbox/polyline'
import {
  IMPORT_PRECISION,
  type ImportFailure,
  type ImportFrame,
  mergeDerivedTags,
  parseTag,
  type TagType,
  validateTag,
} from '@tracks/core'
import { and, eq, sql } from 'drizzle-orm'
import type { Db, Writer } from './db.ts'
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
 * The whole run is one transaction. That is what makes cancelling free: a dropped
 * connection rolls back instead of leaving a partial import behind. The price is that
 * a crash loses the run rather than leaving rows for the next one to fill — the old
 * pipeline's emergent resumability, traded for an undo that does not need writing.
 */

export interface IngestResult {
  written: number
  /** Activities that failed. One bad frame costs itself and nothing else. */
  failed: ImportFailure[]
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
function acceptDerived(
  writer: Writer,
  owner: Owner,
  registry: Map<string, TagType>,
  derived: string[],
  result: IngestResult,
) {
  const accepted: string[] = []

  for (const raw of derived) {
    const tag = parseTag(raw)
    const seed = tag && !registry.has(tag.type) ? seedFor(tag.type) : undefined
    if (tag && seed) createType(writer.db, owner, registry, { name: tag.type, ...seed })

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
function write(
  writer: Writer,
  owner: Owner,
  registry: Map<string, TagType>,
  frame: ImportFrame,
  result: IngestResult,
) {
  const points = decodePoints(frame)
  const first = points[0]!

  const existing = writer.db
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
        acceptDerived(writer, owner, registry, [...frame.tags, `source:${frame.source}`], result),
      ),
    ),
  }

  let id = existing?.id
  if (id === undefined) {
    id = writer.db.insert(activities).values(row).returning({ id: activities.id }).get().id
  } else {
    writer.db.update(activities).set(row).where(eq(activities.id, id)).run()
    writer.db.delete(trackpoints).where(eq(trackpoints.activityId, id)).run()
  }

  // Chunked to stay well under SQLite's variable limit on a 25k-point track.
  for (let i = 0; i < points.length; i += 500) {
    writer.db
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
 * Consumes frames, writing them all or writing none.
 *
 * `BEGIN IMMEDIATE` rather than a deferred transaction: the write lock is taken up
 * front, so a second importer is refused at the start instead of part-way through.
 * Aborting — which is what a dropped connection means — rolls back.
 */
export async function ingest(
  writer: Writer,
  owner: Owner,
  frames: AsyncIterable<ImportFrame>,
  onWritten: (written: number, title: string | null) => void,
  signal: AbortSignal,
): Promise<IngestResult> {
  const result: IngestResult = {
    written: 0,
    failed: [],
    rejectedTags: new Map(),
  }

  const registry = loadRegistry(writer.db, owner)
  writer.sqlite.exec('BEGIN IMMEDIATE')

  try {
    for await (const frame of frames) {
      signal.throwIfAborted()

      try {
        write(writer, owner, registry, frame, result)
        result.written++
        onWritten(result.written, frame.title)
      } catch (error) {
        result.failed.push({
          externalId: frame.externalId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      // better-sqlite3 is synchronous, so a run of frames inside one body chunk would
      // hold the event loop and the cancellation could not be noticed until it ended.
      await new Promise((resolve) => setImmediate(resolve))
    }

    signal.throwIfAborted()
    writer.sqlite.exec('COMMIT')
  } catch (error) {
    writer.sqlite.exec('ROLLBACK')
    throw error
  }

  return result
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
export function selectWanted(db: Db, owner: Owner, source: string, ids: string[]): string[] {
  const known = new Set(
    db
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
      .map((row) => row.externalId),
  )

  return ids.filter((id) => !known.has(id))
}
