import { SaxesParser } from 'saxes'
import type { TrackPoint } from '../sources/source.ts'

/**
 * GPX and TCX, streamed.
 *
 * Out of the Strava source and into `lib`, because two features read track files now:
 * the activity import, which wants one track out of a zip entry, and planning, which
 * wants everything a dropped file contains. One parser, one set of quirks, one place
 * the day an exporter surprises us.
 *
 * **`saxes` rather than `DOMParser`**, which is a reversal worth stating. `DOMParser`
 * replaced `fast-xml-parser` in M3.5 to drop a dependency, and that was right for a zip
 * entry a few hundred KB long. A dropped file is not that: measured in Firefox on a
 * 100 MB GPX, `parseFromString` blocks the main thread for 7 seconds — not slowly, but
 * *completely*: zero frames render, the map cannot pan, and a spinner would sit frozen
 * mid-animation, because it is synchronous and cannot yield. It also leaves a DOM about
 * twenty times the size of the file.
 *
 * A streaming parser fixes both, and being streamed matters more than being fast: fed
 * from the file's own stream the whole text never exists as a string at all, which took
 * peak memory on that same file from ~470 MB to ~55 MB. What is left is the points
 * themselves. Each chunk boundary is a natural yield point, so frames keep rendering,
 * progress is real, and cancelling is a flag checked in the read loop — none of which
 * `DOMParser` can offer at any size.
 *
 * That is also why there is no size limit anywhere in this module. Time still scales
 * with the file, but nothing breaks, and the caller can watch it and stop it.
 *
 * A hand-rolled scanner measured ten times faster again, and is not worth it: it would
 * be hand-rolled XML in the module the activity import depends on, needing its own
 * answer for comments, CDATA, quoting and entities, plus a second implementation for
 * TCX — which `saxes` reads with the same code.
 *
 * Local names are matched throughout, never qualified ones, so a document that declares
 * its namespace with a prefix parses exactly like one that declares a default.
 */

/** What a `<trk>` or a `<rte>` becomes. One of these is one row in the panel. */
export interface TrackPart {
  /**
   * Which element it came from, kept because they are not the same claim.
   *
   * A track is a recording — dense points, the shape of the road. A route is turn
   * instructions between sparse points, so drawing it as a line cuts every corner. The
   * map says so by drawing a route's own points; it cannot if it does not know.
   */
  kind: 'track' | 'route'
  /** The part's own `<name>`, which may beat the file's. */
  name: string | null
  /** GPX `<type>` or TCX `Sport`. Null when the file does not say. */
  sportRaw: string | null
  points: TrackPoint[]
}

/** A standalone `<wpt>`: somebody else's mark on the map, at its own coordinates. */
export interface TrackWaypoint {
  lat: number
  lon: number
  name: string | null
}

export interface TrackFile {
  /** `<metadata><name>`, when the file carries one. */
  name: string | null
  parts: TrackPart[]
  waypoints: TrackWaypoint[]
}

export interface ParseOptions {
  /** Total bytes, when known, so progress can be a fraction rather than a count. */
  totalBytes?: number
  /** Bytes consumed so far. Called once per chunk, which is once per yield. */
  onProgress?: (bytesRead: number, totalBytes: number | null) => void
  signal?: AbortSignal
}

const num = (raw: string | null | undefined): number | null => {
  if (raw === undefined || raw === null || raw === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const epoch = (raw: string | null): number | null => {
  if (raw === null) return null
  const ms = Date.parse(raw)
  return Number.isNaN(ms) ? null : Math.round(ms / 1000)
}

const trimmed = (raw: string): string | null => {
  const value = raw.trim()
  return value === '' ? null : value
}

/** Strips any namespace prefix: `gpx:trkpt` and `trkpt` are the same element here. */
function localName(name: string): string {
  const colon = name.indexOf(':')
  return colon === -1 ? name : name.slice(colon + 1)
}

/**
 * The whole file, read as one pass of SAX events.
 *
 * Written as a class rather than a closure because it is a state machine with eight
 * fields, and a stack of local names is how "a `<name>` inside `<trk>`" is told from
 * "a `<name>` inside `<trkpt>`" — the same distinction the DOM version needed
 * `directChild` for, and the one that decides whether a waypoint's name becomes the
 * track's.
 */
class TrackFileReader {
  readonly parser = new SaxesParser()

  #stack: string[] = []
  #text = ''
  #failure: Error | null = null

  #name: string | null = null
  #parts: TrackPart[] = []
  #waypoints: TrackWaypoint[] = []

  /** The part currently open, and the point currently open inside it. */
  #part: TrackPart | null = null
  #point: (TrackPoint & { lat: number; lon: number }) | null = null
  #waypoint: TrackWaypoint | null = null

  constructor() {
    this.parser.on('error', (error) => {
      this.#failure ??= error instanceof Error ? error : new Error(String(error))
    })
    this.parser.on('opentag', (tag) => this.#open(localName(tag.name), tag.attributes))
    this.parser.on('text', (text) => {
      this.#text += text
    })
    this.parser.on('closetag', (tag) => this.#close(localName(tag.name)))
  }

  #open(name: string, attributes: Record<string, string | { value: string }>): void {
    // saxes hands back plain strings without `xmlns: true`, and objects with it. Take
    // both, so turning that option on later cannot silently produce NaN coordinates.
    const attribute = (key: string): string | null => {
      const raw = attributes[key]
      if (raw === undefined) return null
      return typeof raw === 'string' ? raw : raw.value
    }

    this.#text = ''
    this.#stack.push(name)

    switch (name) {
      case 'trk':
        this.#part = { kind: 'track', name: null, sportRaw: null, points: [] }
        this.#parts.push(this.#part)
        return
      case 'rte':
        this.#part = { kind: 'route', name: null, sportRaw: null, points: [] }
        this.#parts.push(this.#part)
        return
      // TCX has no `<trk>`; an Activity is the part, and its sport is an attribute.
      case 'Activity':
        this.#part = {
          kind: 'track',
          name: null,
          sportRaw: attribute('Sport'),
          points: [],
        }
        this.#parts.push(this.#part)
        return
      case 'trkpt':
      case 'rtept': {
        const lat = num(attribute('lat'))
        const lon = num(attribute('lon'))
        // A point without coordinates is not a point. Dropped rather than defaulted:
        // a (0, 0) in the Gulf of Guinea would draw a line across the planet.
        this.#point =
          lat === null || lon === null ? null : { lat, lon, altitudeM: null, recordedAt: null }
        return
      }
      case 'Trackpoint':
        // TCX puts the coordinates in child elements, so the point starts empty and is
        // discarded at close if `<Position>` never arrived — which is what a pause is.
        this.#point = { lat: Number.NaN, lon: Number.NaN, altitudeM: null, recordedAt: null }
        return
      case 'wpt': {
        const lat = num(attribute('lat'))
        const lon = num(attribute('lon'))
        this.#waypoint = lat === null || lon === null ? null : { lat, lon, name: null }
        return
      }
      default:
        return
    }
  }

  #close(name: string): void {
    const text = this.#text
    this.#text = ''
    this.#stack.pop()
    const parent = this.#stack[this.#stack.length - 1]

    switch (name) {
      case 'name':
        // Whose name this is, is entirely a question of what it sits inside. A `<name>`
        // in a `<wpt>` becoming the track's was the bug the DOM version's `directChild`
        // existed to prevent; here the stack answers it.
        if (parent === 'metadata') this.#name ??= trimmed(text)
        else if (parent === 'trk' || parent === 'rte') {
          if (this.#part) this.#part.name ??= trimmed(text)
        } else if (parent === 'wpt' && this.#waypoint) this.#waypoint.name ??= trimmed(text)
        return
      case 'type':
        if ((parent === 'trk' || parent === 'rte') && this.#part) {
          this.#part.sportRaw ??= trimmed(text)
        }
        return
      // TCX's nearest thing to a title.
      case 'Notes':
        if (parent === 'Activity' && this.#part) this.#part.name ??= trimmed(text)
        return
      case 'ele':
        if (this.#point) this.#point.altitudeM = num(text)
        return
      case 'AltitudeMeters':
        if (this.#point && parent === 'Trackpoint') this.#point.altitudeM = num(text)
        return
      case 'time':
        if (this.#point) this.#point.recordedAt = epoch(trimmed(text))
        return
      case 'Time':
        if (this.#point && parent === 'Trackpoint') this.#point.recordedAt = epoch(trimmed(text))
        return
      case 'LatitudeDegrees':
        if (this.#point) this.#point.lat = num(text) ?? Number.NaN
        return
      case 'LongitudeDegrees':
        if (this.#point) this.#point.lon = num(text) ?? Number.NaN
        return
      case 'trkpt':
      case 'rtept':
      case 'Trackpoint': {
        const point = this.#point
        this.#point = null
        // A TCX pause has a `<Time>` and no `<Position>`; a GPX point with unusable
        // attributes never became one. Both are skipped rather than drawn.
        if (point && Number.isFinite(point.lat) && Number.isFinite(point.lon)) {
          this.#part?.points.push(point)
        }
        return
      }
      case 'wpt': {
        if (this.#waypoint) this.#waypoints.push(this.#waypoint)
        this.#waypoint = null
        return
      }
      case 'trk':
      case 'rte':
      case 'Activity':
        this.#part = null
        return
      default:
        return
    }
  }

  finish(fileName: string): TrackFile {
    try {
      this.parser.close()
    } catch (error) {
      this.#failure ??= error instanceof Error ? error : new Error(String(error))
    }
    if (this.#failure) throw new Error(`${fileName} is not parseable XML`)

    // A part with nothing in it is not a part — a `<rte>` with no `<rtept>` draws
    // nothing and would be a row in the panel that means nothing.
    const parts = this.#parts.filter((part) => part.points.length > 0)
    return { name: this.#name, parts, waypoints: this.#waypoints }
  }
}

/** Gzip's magic number, so a `.gpx` that is really gzipped is still read. */
const GZIP_MAGIC = [0x1f, 0x8b]

/**
 * Streams the file, gunzipping if it turns out to be gzipped.
 *
 * Sniffed rather than taken from the name: a dropped file is named by whoever made it,
 * and `activities/1001.gpx` inside a Strava archive is gzipped while plenty of
 * `.gpx.gz` downloads are not. The first chunk is read, checked and pushed back, so
 * nothing is buffered beyond it.
 */
async function bytes(stream: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader()
  const first = await reader.read()
  const head = first.done ? new Uint8Array() : first.value
  const gzipped = head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1]

  let pushedBack = false
  const restored = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!pushedBack) {
        pushedBack = true
        if (head.length > 0) {
          controller.enqueue(head)
          return
        }
      }
      const next = await reader.read()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    cancel: (reason) => reader.cancel(reason),
  })

  // `DecompressionStream` is typed as accepting `BufferSource`, which does not unify
  // with a `Uint8Array` stream. The cast is the same one `gzip.ts` avoids by taking an
  // untyped `TransformStream`; here the stream types are worth keeping either side of it.
  const inflate = new DecompressionStream('gzip') as unknown as ReadableWritablePair<
    Uint8Array,
    Uint8Array
  >
  return gzipped ? restored.pipeThrough(inflate) : restored
}

/**
 * Read a track file from a stream.
 *
 * Decoded with a `TextDecoder` in streaming mode rather than a `TextDecoderStream`,
 * for the reason `gzip.ts` builds its own `ReadableStream`: the convenient spelling is
 * missing in jsdom, so it would work in every real browser and fail only in the tests.
 */
export async function parseTrackStream(
  fileName: string,
  stream: ReadableStream<Uint8Array>,
  options: ParseOptions = {},
): Promise<TrackFile> {
  const reader = (await bytes(stream)).getReader()
  const decoder = new TextDecoder()
  const reading = new TrackFileReader()
  const total = options.totalBytes ?? null
  let read = 0
  /**
   * Strava's TCX files begin with whitespace before `<?xml`, which is strictly
   * malformed — an XML parser is entitled to reject the document, and both of these
   * do. The DOM version trimmed the whole string; streaming, the same fix is to trim
   * the front of the first chunk that has anything in it.
   */
  let started = false

  try {
    for (;;) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted')

      const { done, value } = await reader.read()
      if (done) break

      read += value.length
      let text = decoder.decode(value, { stream: true })
      if (!started) {
        text = text.replace(/^\s+/, '')
        started = text !== ''
      }
      reading.parser.write(text)
      // Once per chunk, which is once per turn of the event loop — so a progress bar
      // animates and the map stays pannable while a large file comes in.
      options.onProgress?.(read, total)
    }
    reading.parser.write(decoder.decode())
  } finally {
    reader.cancel().catch(() => {})
  }

  return reading.finish(fileName)
}

/** The same, from bytes already in hand — what the activity import has. */
export function parseTrackBytes(fileName: string, raw: Uint8Array): Promise<TrackFile> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(raw)
      controller.close()
    },
  })
  return parseTrackStream(fileName, stream)
}
