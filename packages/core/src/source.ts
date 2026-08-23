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
 *
 * Archiving raw payloads is deliberately absent. A source that is expensive or
 * unreliable to re-read writes its own payloads as it fetches them, when it
 * already holds them — the pipeline neither knows nor needs to.
 */
export interface ActivitySource {
  readonly name: string

  listActivities(): AsyncIterable<SourceActivity>

  /** Null when the source has no track for this activity. */
  fetchTrack(externalId: string): Promise<Track | null>
}
