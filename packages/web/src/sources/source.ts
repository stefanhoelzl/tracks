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
   * Finished `<type>:<value>` tags the source derived for this activity — today
   * just `sport:`. Each source owns its own vocabulary, because what Komoot means
   * by `touringbicycle` and what a GPX `<type>` means are facts about two services,
   * free to drift apart.
   *
   * Empty means the source said nothing, which is meaningfully different from
   * saying something it does not recognise: both derive no tag, and both leave a
   * manual tag alone.
   */
  tags: string[]
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
 * Runs in the browser. Both implementations read something the browser can already
 * reach — a file the user picked, and an API that sends `Access-Control-Allow-Origin: *`
 * — so the server never learns what a Strava export or a Komoot tour is. It receives
 * finished activities and writes them.
 *
 * Deliberately knows nothing about its implementations: `name` is a plain string, and
 * pagination or zip lookup stays internal to the async iterable. A zip satisfies this
 * exactly as well as an HTTP API does.
 *
 * Archiving raw payloads is deliberately absent, and now impossible: nothing is written
 * to disk on either side. A re-import never re-reads a track it already has, which is
 * what made the archive unnecessary rather than merely unused.
 */
export interface ActivitySource {
  readonly name: string

  listActivities(): AsyncIterable<SourceActivity>

  /** Null when the source has no track for this activity. */
  fetchTrack(externalId: string): Promise<Track | null>
}
