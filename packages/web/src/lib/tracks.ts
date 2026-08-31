import polyline from '@mapbox/polyline'
import type { TrackCollection, TracksResponse } from '@tracks/core'

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
