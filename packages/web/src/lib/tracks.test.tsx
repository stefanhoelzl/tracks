import polyline from '@mapbox/polyline'
import type { TracksResponse } from '@tracks/core'
import { describe, expect, it } from 'vitest'
import { decodeTracks } from './tracks.ts'

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
