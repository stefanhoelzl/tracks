import { join } from 'node:path'
import polyline from '@mapbox/polyline'
import {
  type ActivitySource,
  activities,
  isReservedTag,
  simplify,
  toSport,
  trackpoints,
  utcOffsetAt,
} from '@tracks/core'
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from './db.ts'

export interface ImportResult {
  seen: number
  imported: number
  skippedNoTrack: number
  unchanged: number
  failed: Array<{ externalId: string; error: string }>
}

/**
 * Merges the automatic sport tag into an activity's existing tags.
 *
 * Re-derivation only acts when the source actually supplies a type. Where it does
 * not, existing tags are returned untouched — so a manual `ride` tag on a
 * third-party upload with no `<type>` survives every future import.
 */
export function mergeSportTag(existing: string[], sport: string | null): string[] {
  if (sport === null) return existing
  return [...existing.filter((t) => !isReservedTag(t)), sport]
}

export async function importSource(
  db: Db,
  source: ActivitySource,
  opts: { rawDir?: string } = {},
): Promise<ImportResult> {
  const result: ImportResult = { seen: 0, imported: 0, skippedNoTrack: 0, unchanged: 0, failed: [] }

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
      if (existing) {
        const counted = db
          .select({ n: sql<number>`count(*)` })
          .from(trackpoints)
          .where(eq(trackpoints.activityId, existing.id))
          .get()
        if ((counted?.n ?? 0) > 0) {
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
        tags: JSON.stringify(
          mergeSportTag(
            existing ? (JSON.parse(existing.tags) as string[]) : [],
            toSport(track.sportRaw),
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

      if (opts.rawDir) {
        await source.archiveRaw?.(
          activity.externalId,
          join(opts.rawDir, source.name, activity.externalId),
        )
      }
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
