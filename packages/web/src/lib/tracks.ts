import polyline from '@mapbox/polyline'
import {
  type ActivityDetail,
  type ActivityDetailResponse,
  altitudesFromScalars,
  decodeScalars,
  TRACK_PRECISION,
  type TrackCollection,
  type TracksResponse,
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
        .decode(response.track.polyline, TRACK_PRECISION)
        .map(([lat, lon]) => [lon, lat]),
      // Three strings in, three arrays out, all decoded in the one place the response is
      // adapted — so `ElevationProfile` and `geo.ts` still see the nullable number array
      // they always did, and never learn that the wire stopped sending one.
      altitudeM: altitudesFromScalars(decodeScalars(response.track.altitudes)),
      secondsFromStart: decodeScalars(response.track.times),
    },
  }
}
