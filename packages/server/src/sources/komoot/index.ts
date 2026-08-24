import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ActivitySource, SourceActivity, Track, TrackPoint } from '@tracks/core'
import { KomootClient, type KomootClientOptions, type KomootTourDetail } from './client.ts'
import { sportTags } from './sport.ts'

export interface KomootSourceOptions extends KomootClientOptions {
  /**
   * Where to archive each tour's JSON. Unlike a file export, Komoot's API cannot
   * cheaply or reliably be re-read, so keeping the payload is what makes a future
   * schema change a backfill rather than a re-scrape.
   */
  rawDir?: string
}

/**
 * Komoot, over its undocumented API.
 *
 * Only recorded tours are imported. Planned ones are routes that may never have
 * been ridden, so counting them would inflate every total.
 */
export class KomootSource implements ActivitySource {
  readonly name = 'komoot'

  #client: KomootClient
  #rawDir: string | undefined
  #startedAt = new Map<string, Date>()

  constructor(options: KomootSourceOptions) {
    this.#client = new KomootClient(options)
    this.#rawDir = options.rawDir
  }

  async *listActivities(): AsyncIterable<SourceActivity> {
    for await (const tour of this.#client.tours()) {
      if (tour.type !== 'tour_recorded') continue

      const startedAt = tour.date ? new Date(tour.date) : null
      if (!startedAt || Number.isNaN(startedAt.getTime())) continue

      const externalId = String(tour.id)
      // fetchTrack needs this to turn each point's millisecond offset into an
      // absolute time, and the detail response is not guaranteed to repeat it.
      this.#startedAt.set(externalId, startedAt)

      yield {
        externalId,
        title: tour.name ?? null,
        startedAt,
        distanceM: tour.distance ?? null,
        durationS: tour.time_in_motion ?? null,
        elapsedS: tour.duration ?? null,
        elevationGainM: tour.elevation_up ?? null,
      }
    }
  }

  async fetchTrack(externalId: string): Promise<Track | null> {
    const tour = await this.#client.tour(externalId)
    await this.#archive(externalId, tour)

    const items = tour._embedded?.coordinates?.items ?? []
    if (items.length === 0) return null

    const startedAt = this.#startedAt.get(externalId) ?? (tour.date ? new Date(tour.date) : null)
    const startEpoch = startedAt ? Math.round(startedAt.getTime() / 1000) : null

    // A tour whose every offset is 0 carries no real timing — stamping all of its
    // points at the start would be worse than admitting the times are unknown.
    const timed = startEpoch !== null && items.some((item) => (item.t ?? 0) > 0)

    const points: TrackPoint[] = items.map((item) => ({
      lat: item.lat,
      lon: item.lng,
      altitudeM: item.alt ?? null,
      // `t` is milliseconds since the tour began.
      recordedAt: timed ? startEpoch + Math.round((item.t ?? 0) / 1000) : null,
    }))

    return { points, tags: sportTags(tour.sport), title: tour.name ?? null }
  }

  async #archive(externalId: string, tour: KomootTourDetail): Promise<void> {
    if (!this.#rawDir) return
    const dir = join(this.#rawDir, this.name, externalId)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'tour.json'), JSON.stringify(tour))
  }
}
