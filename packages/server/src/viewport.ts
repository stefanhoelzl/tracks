/**
 * Does a track enter a viewport?
 *
 * The question the map's filter asks, answered against the simplified polyline each
 * activity already stores rather than against its points. It used to be SQL over
 * `trackpoints` — `lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?` over every point of every
 * candidate — which walked 1,045,599 rows for a whole-extent viewport, once per request
 * and three times per pan, with no early exit because `DISTINCT` cannot stop at the first
 * match. Measured, not assumed: a UDF counting row examinations reported 100% of the table.
 *
 * Segments, never points. A track's *points* are a sampling of it, so testing them asks
 * "did the recorder happen to sample inside this rectangle?", which is a different
 * question at any zoom where the rectangle approaches the ~11 m point spacing — and a
 * simplified line's points answer it wrongly 153 times in 3,937. The line *between* two
 * kept points is the track's claim about where it went, and testing that is both cheaper
 * and closer to what is being asked.
 *
 * Accuracy against the old point test, 200 viewports per zoom: identical at 2°, 0.5°, 0.1°
 * and 0.02° — no activity gained or lost in 800 viewports. It parts company only below
 * that, where the 10 m simplification tolerance is a visible fraction of the viewport:
 * one activity missed in 2,266 at ~400 m, nine in 1,791 at ~80 m. Both are zooms at which
 * the rectangle is smaller than a city block and the tracks in it are on screen anyway.
 * If that ever matters, the full-resolution geometry is on the same row.
 */

/** `[west, south, east, north]`, as the filter carries it. */
export type Bbox = readonly [number, number, number, number]

/**
 * Liang–Barsky, against an axis-aligned rectangle.
 *
 * Longitude is x and latitude is y throughout — degrees, unprojected. A projection would
 * buy nothing here: the test is an intersection, not a distance, and intersection is
 * preserved by the affine scaling a projection would apply.
 */
function segmentCrosses(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  [west, south, east, north]: Bbox,
): boolean {
  // Either end inside is the common case and answers immediately.
  if (x1 >= west && x1 <= east && y1 >= south && y1 <= north) return true
  if (x2 >= west && x2 <= east && y2 >= south && y2 <= north) return true

  // Neither end inside, and the segment's own box misses the viewport: no crossing.
  if (Math.max(x1, x2) < west || Math.min(x1, x2) > east) return false
  if (Math.max(y1, y2) < south || Math.min(y1, y2) > north) return false

  // What is left is a segment that may cut a corner with both ends outside. Clip its
  // parameter range against each edge in turn; an empty range means it passes by.
  const dx = x2 - x1
  const dy = y2 - y1
  let enter = 0
  let leave = 1

  for (const [p, q] of [
    [-dx, x1 - west],
    [dx, east - x1],
    [-dy, y1 - south],
    [dy, north - y1],
  ] as const) {
    if (p === 0) {
      // Parallel to this edge: outside it is a miss, inside it constrains nothing.
      if (q < 0) return false
      continue
    }
    const t = q / p
    if (p < 0) {
      if (t > leave) return false
      if (t > enter) enter = t
    } else {
      if (t < enter) return false
      if (t < leave) leave = t
    }
  }

  return true
}

/**
 * Whether any segment of a decoded line enters the viewport.
 *
 * A one-point line is degenerate — no segment to test — so it is checked as a point,
 * which is the only sensible reading of a track that recorded once.
 */
export function crossesViewport(
  coordinates: ReadonlyArray<readonly [number, number]>,
  bbox: Bbox,
): boolean {
  const [west, south, east, north] = bbox

  if (coordinates.length === 1) {
    const [lat, lon] = coordinates[0]!
    return lon >= west && lon <= east && lat >= south && lat <= north
  }

  for (let i = 1; i < coordinates.length; i++) {
    const [lat1, lon1] = coordinates[i - 1]!
    const [lat2, lon2] = coordinates[i]!
    if (segmentCrosses(lon1, lat1, lon2, lat2, bbox)) return true
  }

  return false
}
