import type { Filter } from '@tracks/core'

/**
 * The camera, narrowed to a place on the earth.
 *
 * `getBounds()` answers in camera space, where the world repeats horizontally and the
 * projection runs past the poles: zoomed out it reports longitudes beyond ±180, which
 * means *everything, and then some*, and latitudes beyond ±90, which means the grey
 * above and below the map. `bboxSchema` answers in geographic space, where ±180 and
 * ±90 are the edges of the only world there is.
 *
 * Neither is wrong; they are answers to different questions, and this is the step
 * between them. Without it the first load — a wide camera, because nothing in the URL
 * has told it where to look yet — sent the API a box wider than the world and got a
 * 400 back, so the list said it could not load activities until you reloaded into a
 * bbox the map had narrowed itself.
 */

type Bbox = NonNullable<Filter['bbox']>

const LON = 180
const LAT = 90

const clamp = (value: number, limit: number) => Math.min(limit, Math.max(-limit, value))

/** Into [-180, 180), so a camera panned past the antimeridian names the place it is over. */
const wrap = (lon: number) => ((((lon + LON) % 360) + 360) % 360) - LON

export function geographicBbox([west, south, east, north]: Bbox): Bbox {
  // Mercator cannot show the poles, so a camera that reaches past them is looking at
  // nothing; the pole is as far as the answer goes.
  const bottom = clamp(south, LAT)
  const top = clamp(north, LAT)

  // A camera already over the world it is describing, passed through arithmetic and
  // all: these longitudes go on to the URL, and `10.24` taken apart and put back
  // together again is `10.240000000000009`.
  if (west >= -LON && east <= LON) return [west, bottom, east, top]

  /**
   * A view that crosses the antimeridian is widened, not halved.
   *
   * The schema's box is `w <= e`, so it cannot say "170°E through 170°W" at all —
   * something has to give. Clamping the two numbers would give 170..180 and silently
   * drop the other half: tracks drawn on the screen would be missing from the list,
   * and `w <= e` still holds, so nothing would say so. The whole range is wrong in the
   * other direction — a filter that has stopped narrowing, which the map makes obvious
   * — and it is the same answer the world view already gets. One desktop map over
   * Europe never reaches this; a ride across the Pacific date line would.
   */
  const span = east - west
  if (span >= 360) return [-LON, bottom, LON, top]

  const left = wrap(west)
  const right = left + span
  return right > LON ? [-LON, bottom, LON, top] : [left, bottom, right, top]
}
