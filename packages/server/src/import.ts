import polyline from '@mapbox/polyline'
import { mergeDerivedTags, parseTag, type TagRegistry, validateTag } from '@tracks/core'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './db.ts'
import { simplify } from './polyline.ts'
import { addEnumValue, loadRegistry } from './registry.ts'
import { activities, trackpoints } from './schema.ts'
import type { ActivitySource } from './source.ts'
import { utcOffsetAt } from './timezone.ts'

export interface ImportResult {
  seen: number
  imported: number
  skippedNoTrack: number
  unchanged: number
  failed: Array<{ externalId: string; error: string }>
  /** Enum values a source derived that the registry had lost, and got back. */
  readdedValues: string[]
  /** Derived tags no registry type could accept, counted by tag. */
  rejectedTags: Map<string, number>
}

/**
 * Accepts the tags a source derived, against the registry.
 *
 * A source's vocabulary is a fact and the registry is a preference, so a value an
 * enum has lost is put back rather than dropped. A tag whose *type* is unknown is a
 * different matter — nothing says what it means — so it is dropped and reported.
 * Either way the activity itself imports: a taxonomy choice never fails an import.
 */
function acceptDerived(db: Db, registry: TagRegistry, derived: string[], result: ImportResult) {
  const accepted: string[] = []

  for (const raw of derived) {
    const tag = parseTag(raw)
    const type = tag ? registry.get(tag.type) : undefined

    if (tag && type?.enumValues && !type.enumValues.includes(tag.value)) {
      addEnumValue(db, type, tag.value)
      result.readdedValues.push(raw)
      accepted.push(raw)
      continue
    }

    if (validateTag(registry, raw) !== null) {
      result.rejectedTags.set(raw, (result.rejectedTags.get(raw) ?? 0) + 1)
      continue
    }
    accepted.push(raw)
  }

  return accepted
}

export async function importSource(db: Db, source: ActivitySource): Promise<ImportResult> {
  const registry = loadRegistry(db)
  const result: ImportResult = {
    seen: 0,
    imported: 0,
    skippedNoTrack: 0,
    unchanged: 0,
    failed: [],
    readdedValues: [],
    rejectedTags: new Map(),
  }

  for await (const activity of source.listActivities()) {
    result.seen++
    try {
      const existing = db
        .select({ id: activities.id, tags: activities.tags })
        .from(activities)
        .where(
          and(eq(activities.source, source.name), eq(activities.externalId, activity.externalId)),
        )
        .get()

      // Trackpoints never change, so an activity that already has them is not
      // re-parsed. This is what makes the database its own sync state.
      //
      // Existence, not a count: `count(*)` walks the whole primary-key range for the
      // activity, so the check cost scaled with track length rather than with the one
      // bit it asks for. Stopping at the first row is 14x faster over the archive.
      if (existing) {
        const hasTrack = db
          .select({ present: sql<number>`1` })
          .from(trackpoints)
          .where(eq(trackpoints.activityId, existing.id))
          .limit(1)
          .get()
        if (hasTrack) {
          result.unchanged++
          continue
        }
      }

      const track = await source.fetchTrack(activity.externalId)
      if (!track || track.points.length === 0) {
        result.skippedNoTrack++
        continue
      }

      const first = track.points[0]!
      const row = {
        source: source.name,
        externalId: activity.externalId,
        // The track's own name beats the service title: "Almenrunde" over
        // Strava's auto-generated "Fahrt am Morgen".
        title: track.title ?? activity.title,
        startedAt: activity.startedAt.toISOString(),
        utcOffset: utcOffsetAt(first.lat, first.lon, activity.startedAt),
        distanceM: activity.distanceM,
        durationS: activity.durationS,
        elapsedS: activity.elapsedS,
        elevationGainM: activity.elevationGainM,
        polyline: polyline.encode(
          simplify(track.points).map((p) => [p.lat, p.lon] as [number, number]),
        ),
        // `source:` duplicates the column on purpose: the upsert key needs the
        // column, and the tag is what makes source one more facet like any other.
        tags: JSON.stringify(
          mergeDerivedTags(
            existing ? (JSON.parse(existing.tags) as string[]) : [],
            acceptDerived(db, registry, [...track.tags, `source:${source.name}`], result),
          ),
        ),
      }

      // One transaction per activity: a failure costs this activity and no other.
      db.transaction((tx) => {
        let id = existing?.id
        if (id === undefined) {
          id = tx.insert(activities).values(row).returning({ id: activities.id }).get().id
        } else {
          tx.update(activities).set(row).where(eq(activities.id, id)).run()
          tx.delete(trackpoints).where(eq(trackpoints.activityId, id)).run()
        }

        // Chunked to stay well under SQLite's variable limit on a 25k-point track.
        for (let i = 0; i < track.points.length; i += 500) {
          tx.insert(trackpoints)
            .values(
              track.points.slice(i, i + 500).map((p, j) => ({
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
      })

      result.imported++
    } catch (error) {
      result.failed.push({
        externalId: activity.externalId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}
