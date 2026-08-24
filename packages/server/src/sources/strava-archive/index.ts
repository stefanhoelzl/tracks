import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ActivitySource, SourceActivity, Track } from '../../source.ts'
import { type ArchiveRow, readArchiveCsv } from './csv.ts'
import { sportTags } from './sport.ts'
import { readTrackFile } from './track.ts'

/**
 * Strava's bulk export, read straight from disk.
 *
 * Strava's API has required a paid subscription for Standard Tier developers since
 * June 2026; the archive stays free. Being offline, this source needs no
 * credentials, no rate limiting and no network at all.
 *
 * Deliberately does not implement `archiveRaw`: the export directory is already a
 * durable copy, so re-deriving means re-running the import against it rather than
 * keeping a second copy under data/raw.
 */
export class StravaArchiveSource implements ActivitySource {
  readonly name = 'strava'

  #root: string
  #rows: Map<string, ArchiveRow> | null = null

  constructor(root: string) {
    this.#root = root
  }

  async #load(): Promise<Map<string, ArchiveRow>> {
    if (!this.#rows) {
      const rows = await readArchiveCsv(join(this.#root, 'activities.csv'))
      this.#rows = new Map(rows.map((r) => [r.externalId, r]))
    }
    return this.#rows
  }

  async *listActivities(): AsyncIterable<SourceActivity> {
    for (const row of (await this.#load()).values()) {
      yield {
        externalId: row.externalId,
        title: row.title,
        startedAt: row.startedAt,
        distanceM: row.distanceM,
        durationS: row.durationS,
        elapsedS: row.elapsedS,
        elevationGainM: row.elevationGainM,
      }
    }
  }

  async fetchTrack(externalId: string): Promise<Track | null> {
    const path = await this.#pathFor(externalId)
    if (!path) return null

    // The parser reports what the file said; this source decides what it means.
    const { points, sportRaw, title } = await readTrackFile(path)
    return { points, tags: sportTags(sportRaw), title }
  }

  async #pathFor(externalId: string): Promise<string | null> {
    const row = (await this.#load()).get(externalId)
    if (!row) return null

    // The filename does NOT encode the activity id: 4008673018.gpx.gz belongs to
    // activity 3752382383. Only the CSV's Dateiname column links the two.
    const path = join(this.#root, row.filename)
    try {
      await stat(path)
      return path
    } catch {
      return null
    }
  }
}
