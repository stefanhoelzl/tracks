/** A single GPS sample. */
export interface TrackPoint {
  lat: number
  lon: number
  /** Height above sea level in metres, if the file recorded one. */
  altitudeM: number | null
  /** Unix epoch seconds, UTC. */
  recordedAt: number | null
}

/** A track, plus the metadata the track itself carries. */
export interface Track {
  points: TrackPoint[]
  /**
   * The sport in a locale-independent vocabulary (GPX `<type>`, TCX `Sport`).
   * Null when the source does not say, which is meaningfully different from
   * saying something unrecognised — see `toSport`.
   */
  sportRaw: string | null
  /** The track's own name, which may beat the service's title. */
  title: string | null
}

/** Activity metadata as a source reports it, before any derivation. */
export interface SourceActivity {
  externalId: string
  title: string | null
  /** UTC instant the activity began. */
  startedAt: Date
  distanceM: number | null
  /** Moving time. */
  durationS: number | null
  /** Wall clock, start to finish. */
  elapsedS: number | null
  elevationGainM: number | null
}

/**
 * One place activities come from.
 *
 * Deliberately knows nothing about its implementations: `name` is a plain string,
 * and pagination or directory walking stays internal to the async iterable. A
 * directory of files satisfies this exactly as well as an HTTP API does.
 */
export interface ActivitySource {
  readonly name: string

  listActivities(): AsyncIterable<SourceActivity>

  /** Null when the source has no track for this activity. */
  fetchTrack(externalId: string): Promise<Track | null>

  /**
   * Copies whatever this source considers the raw payload into `destDir`, so a
   * later schema change can backfill from it without re-fetching.
   *
   * Optional, and only worth implementing when re-reading the source is expensive
   * or unreliable — an undocumented API that may change or vanish. A source backed
   * by files you already hold should omit it: re-importing the original export is
   * cheaper than keeping a second copy of it.
   */
  archiveRaw?(externalId: string, destDir: string): Promise<void>
}
