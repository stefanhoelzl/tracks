import type { ActivitySource, SourceActivity, Track } from '../source.ts'
import type { Archive } from './archive.ts'
import { type ArchiveRow, readArchiveCsv } from './csv.ts'
import { sportTags } from './sport.ts'
import { parseTrackFile } from './track.ts'

/**
 * Strava's bulk export, read out of the zip the user picked.
 *
 * Strava's API has required a paid subscription for Standard Tier developers since
 * June 2026; the archive stays free. Being a local file, this source needs no
 * credentials and no network at all — which is also why it belongs in the browser:
 * the file is already there, and uploading a few hundred MB of photos to reach 30 MB
 * of tracks was the only reason the server ever saw it.
 */
export class StravaZipSource implements ActivitySource {
  readonly name = 'strava'

  #archive: Archive
  #rows: Map<string, ArchiveRow> | null = null

  constructor(archive: Archive) {
    this.#archive = archive
  }

  async #load(): Promise<Map<string, ArchiveRow>> {
    if (!this.#rows) {
      const rows = readArchiveCsv(await this.#archive.readText('activities.csv'))
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
    // The filename does NOT encode the activity id: 4008673018.gpx.gz belongs to
    // activity 3752382383. Only the CSV's Dateiname column links the two.
    const row = (await this.#load()).get(externalId)
    if (!row) return null

    const bytes = await this.#archive.read(row.filename)
    if (!bytes) return null

    // The parser reports what the file said; this source decides what it means.
    const { points, sportRaw, title } = await parseTrackFile(row.filename, bytes)
    return { points, tags: sportTags(sportRaw), title }
  }
}
