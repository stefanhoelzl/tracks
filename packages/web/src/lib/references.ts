import { simplify } from '@tracks/core'
import { colourForSlot, PALETTE_SIZE, preferredSlot } from './colour.ts'
import { parseTrackStream, type TrackFile, type TrackWaypoint } from './gpx-parser.ts'

/**
 * A dropped file, on the map.
 *
 * Transient by the same rule the plan is: planning owns its own state and destroys it
 * on the way out. Unlike the plan it is not even in the URL — a file's points are two
 * orders of magnitude past what a fragment can carry, and a reference is a thing you
 * are looking at rather than a thing you are making. So it lives here, in memory, and
 * a reload asks for the file again.
 *
 * The unit is a **part**, not a file. One `<trk>` is one row; a six-day export is six,
 * dismissed one at a time. `<rte>` is a part too, and marked as one, because a route is
 * turn instructions rather than a drawing of the road and the map has to say so.
 */

export interface ReferencePoint {
  lat: number
  lon: number
  altitudeM: number | null
}

export interface Reference {
  /** Stable for the life of the part, and what dismissing one addresses. */
  id: string
  /** The part's own name, else the file's, else the file name. */
  name: string
  kind: 'track' | 'route'
  /** Which palette slot the colour came from, so the next file can avoid it. */
  slot: number
  colour: string
  /** Thinned to the same tolerance every activity on this map already is. */
  points: ReferencePoint[]
  distanceM: number
  /** The file's `<wpt>`s, at their own coordinates. Carried by the first part only. */
  waypoints: TrackWaypoint[]
}

/** Metres between two points, on a sphere. Enough for a distance readout. */
function haversineM(a: ReferencePoint, b: ReferencePoint): number {
  const R = 6_371_000
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLon = (b.lon - a.lon) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * How long the part is, summed over its own points.
 *
 * Haversine, and deliberately the only figure derived here. Ascent would be the other
 * obvious one and is not offered: nothing in this app computes it from points, and a
 * number invented here would sit beside BRouter's filtered ascent for the same line and
 * disagree with it. Distance has no filtering choice in it to get wrong.
 *
 * Measured on the thinned points, so it is the length of the line actually drawn.
 */
function lengthOf(points: readonly ReferencePoint[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1]!, points[i]!)
  }
  return total
}

/**
 * A colour per part, hashed from its name and probed on collision.
 *
 * The same mechanism tag values use, so the row's dot is a legend that means what every
 * other dot in this app means, and re-dropping a file gives the same colour. `taken`
 * carries the slots already on screen, so two references never land on one hue while a
 * free one exists.
 *
 * Slot 0 is skipped outright. It is `#0a6b48`, and the plan is `#0d8a5f`: near enough
 * that a reference in it reads as the route you are drawing rather than as one you are
 * drawing against, which is the one confusion this feature must not create.
 */
const ACCENT_LIKE_SLOT = 0

export function slotFor(name: string, taken: ReadonlySet<number>): number {
  let slot = preferredSlot(name)
  for (let step = 0; step < PALETTE_SIZE; step++) {
    if (slot !== ACCENT_LIKE_SLOT && !taken.has(slot)) return slot
    slot = (slot + 1) % PALETTE_SIZE
  }
  // Every slot spoken for: collide rather than refuse a file over a colour.
  return preferredSlot(name) === ACCENT_LIKE_SLOT ? 1 : preferredSlot(name)
}

/** What a file becomes: one reference per part that has points. */
export function referencesOf(
  file: TrackFile,
  fileName: string,
  taken: ReadonlySet<number>,
): Reference[] {
  const slots = new Set(taken)
  const base = fileName.replace(/\.(gpx|tcx)(\.gz)?$/i, '')

  return file.parts.map((part, index) => {
    const name = part.name ?? file.name ?? base
    const slot = slotFor(`${name}#${index}`, slots)
    slots.add(slot)

    const points = simplify(
      part.points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        altitudeM: point.altitudeM,
      })),
    )

    return {
      id: `${base}:${index}:${crypto.randomUUID()}`,
      name,
      kind: part.kind,
      slot,
      colour: colourForSlot(slot),
      points,
      distanceM: lengthOf(points),
      // Waypoints belong to the file, not to a part, so only the first row carries
      // them — drawing them once per part would stack identical marks.
      waypoints: index === 0 ? file.waypoints : [],
    }
  })
}

/**
 * The file as a stream of bytes.
 *
 * `file.stream()` in every real browser, and a one-chunk stream over `arrayBuffer()`
 * where it is missing — which is jsdom, and therefore the tests. The same shape
 * `gzip.ts` builds by hand for the same reason: one spelling that works in both is
 * worth more than the nicer line that fails only where nobody is looking.
 */
function streamOf(file: File): ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>> {
  if (typeof file.stream === 'function') return file.stream()

  return file.arrayBuffer().then(
    (buffer) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(buffer))
          controller.close()
        },
      }),
  )
}

/** Reads one dropped file. Rejects with a message the banner can show as it is. */
export async function readReference(
  file: File,
  taken: ReadonlySet<number>,
  options: { onProgress?: (read: number, total: number | null) => void; signal?: AbortSignal } = {},
): Promise<Reference[]> {
  const parsed = await parseTrackStream(file.name, await streamOf(file), {
    totalBytes: file.size,
    ...options,
  })

  const references = referencesOf(parsed, file.name, taken)
  // A well-formed file with no track in it is a failure with a name, not an empty
  // success — otherwise a drop that does nothing looks like a drop that was ignored.
  if (references.length === 0) throw new Error(`${file.name} has no track in it`)
  return references
}
