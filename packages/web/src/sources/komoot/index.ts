import type { ActivitySource, SourceActivity, Track, TrackPoint } from '../source.ts'
import { KomootClient, type KomootClientOptions } from './client.ts'
import { sportTags } from './sport.ts'

/**
 * Komoot, over its undocumented API, called straight from the browser.
 *
 * Only recorded tours are imported. Planned ones are routes that may never have
 * been ridden, so counting them would inflate every total.
 *
 * Nothing is archived. The server-side version kept each tour's JSON under `data/raw`
 * because the API is expensive to re-read — but a re-import never re-reads a tour it
 * already has, so the archive only ever protected against something that does not
 * happen.
 */
export class KomootSource implements ActivitySource {
  readonly name = 'komoot'

  #client: KomootClient
  #startedAt = new Map<string, Date>()

  constructor(options: KomootClientOptions) {
    this.#client = new KomootClient(options)
  }

  /** Fails early and specifically, so bad credentials never reach a progress bar. */
  async verify(): Promise<void> {
    await this.#client.login()
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
}
