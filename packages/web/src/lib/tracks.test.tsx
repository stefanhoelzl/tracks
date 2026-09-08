import polyline from '@mapbox/polyline'
import {
  type ActivityDetailResponse,
  altitudesToScalars,
  encodeScalars,
  type TracksResponse,
} from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { decodeActivityDetail, decodeTracks } from './tracks.ts'

describe('decodeTracks', () => {
  const response: TracksResponse = {
    tracks: [
      {
        id: 7,
        polyline: polyline.encode([
          [46.35, 13.75],
          [46.36, 13.76],
        ]),
        tags: ['sport:hike'],
        year: 2025,
      },
    ],
  }

  it('flips the encoded [lat, lon] pairs into GeoJSON order', () => {
    const [feature] = decodeTracks(response).features

    expect(feature!.geometry.coordinates[0]![0]).toBeCloseTo(13.75, 4)
    expect(feature!.geometry.coordinates[0]![1]).toBeCloseTo(46.35, 4)
  })

  it('carries id, tags and year through to the properties colour-by reads', () => {
    const [feature] = decodeTracks(response).features

    expect(feature!.id).toBe(7)
    expect(feature!.properties).toEqual({ id: 7, tags: ['sport:hike'], year: 2025 })
  })

  it('decodes an empty payload to an empty collection, not a missing one', () => {
    expect(decodeTracks({ tracks: [] })).toEqual({ type: 'FeatureCollection', features: [] })
  })
})

describe('decodeActivityDetail', () => {
  const activity = {
    id: 7,
    source: 'komoot',
    title: 'Orla Perc',
    startedAt: '2025-07-04T06:00:00.000Z',
    utcOffset: 7200,
    localDate: '2025-07-04',
    distanceM: 15_000,
    durationS: 18_000,
    elapsedS: 20_000,
    elevationGainM: 1900,
    speedMs: 0.8333,
    tags: ['sport:hike'],
  }

  it('round-trips six-decimal coordinates exactly, in GeoJSON order', () => {
    const response: ActivityDetailResponse = {
      activity,
      track: {
        polyline: polyline.encode(
          [
            [46.751234, 14.351234],
            [46.762345, 14.362345],
          ],
          6,
        ),
        altitudes: encodeScalars(altitudesToScalars([1500, 1600])),
        times: encodeScalars([0, 7]),
      },
    }

    // Precision 6 is lossless for this data, so equality rather than closeness.
    expect(decodeActivityDetail(response).track.coordinates).toEqual([
      [14.351234, 46.751234],
      [14.362345, 46.762345],
    ])
  })

  it('keeps altitude aligned with the coordinates, nulls included', () => {
    const response: ActivityDetailResponse = {
      activity,
      track: {
        polyline: polyline.encode(
          [
            [46.35, 13.75],
            [46.36, 13.76],
          ],
          6,
        ),
        altitudes: encodeScalars(altitudesToScalars([1500, null])),
        times: encodeScalars([0, null]),
      },
    }
    const { coordinates, altitudeM } = decodeActivityDetail(response).track

    expect(altitudeM).toEqual([1500, null])
    expect(altitudeM).toHaveLength(coordinates.length)
  })
})
