import polyline from '@mapbox/polyline'
import type {
  ActivityDetail,
  ActivityDetailResponse,
  TrackCollection,
  TracksResponse,
} from '@tracks/core'

/**
 * Wire payload to the GeoJSON the map renders.
 *
 * Done once per response, on the way out of the query, so everything downstream — the
 * colour pass, the start points, the bounds — works with decoded geometry exactly as it
 * did when the server sent it decoded.
 */
export function decodeTracks(response: TracksResponse): TrackCollection {
  return {
    type: 'FeatureCollection',
    features: response.tracks.map((track) => ({
      type: 'Feature',
      id: track.id,
      geometry: {
        type: 'LineString',
        // Encoded as [lat, lon] pairs; GeoJSON wants them the other way round.
        coordinates: polyline.decode(track.polyline).map(([lat, lon]) => [lon, lat]),
      },
      properties: { id: track.id, tags: track.tags, year: track.year },
    })),
  }
}

/** Lossless for six-decimal trackpoints — must match what the route encodes with. */
const DETAIL_PRECISION = 6

/**
 * One activity's full-resolution track, decoded once on arrival.
 *
 * The coordinates come out in GeoJSON order and are handed to the map as they are: the
 * selected-track line and its hit layer both used to rebuild a 34k-point array each.
 */
export function decodeActivityDetail(response: ActivityDetailResponse): ActivityDetail {
  return {
    activity: response.activity,
    track: {
      coordinates: polyline
        .decode(response.track.polyline, DETAIL_PRECISION)
        .map(([lat, lon]) => [lon, lat]),
      altitudeM: response.track.altitudeM,
    },
  }
}
