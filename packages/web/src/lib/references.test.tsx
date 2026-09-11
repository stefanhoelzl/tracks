import { describe, expect, it } from 'vitest'
import { colourForSlot } from './colour.ts'
import type { TrackFile } from './gpx-parser.ts'
import { referencesOf, slotFor } from './references.ts'

const point = (lat: number, lon: number, altitudeM: number | null = 100) => ({
  lat,
  lon,
  altitudeM,
  recordedAt: null,
})

const file = (over: Partial<TrackFile> = {}): TrackFile => ({
  name: 'Alpencross',
  parts: [
    {
      kind: 'track',
      name: 'Day 3',
      sportRaw: null,
      // Far enough apart to survive a 10 m simplification.
      points: [point(47.0, 11.0), point(47.01, 11.01), point(47.02, 11.0)],
    },
  ],
  waypoints: [{ lat: 47.0, lon: 11.0, name: 'Hut' }],
  ...over,
})

describe('what a file becomes', () => {
  it('makes one reference per part, not per file', () => {
    const references = referencesOf(
      file({
        parts: [
          {
            kind: 'track',
            name: 'Day 3',
            sportRaw: null,
            points: [point(47, 11), point(47.1, 11)],
          },
          {
            kind: 'track',
            name: 'Day 4',
            sportRaw: null,
            points: [point(47.1, 11), point(47.2, 11)],
          },
        ],
      }),
      'alpencross.gpx',
      new Set(),
    )

    expect(references.map((reference) => reference.name)).toEqual(['Day 3', 'Day 4'])
  })

  it('carries the file waypoints on the first part only, so marks are not stacked', () => {
    const references = referencesOf(
      file({
        parts: [
          { kind: 'track', name: 'a', sportRaw: null, points: [point(47, 11), point(47.1, 11)] },
          { kind: 'track', name: 'b', sportRaw: null, points: [point(47.1, 11), point(47.2, 11)] },
        ],
      }),
      'alpencross.gpx',
      new Set(),
    )

    expect(references[0]?.waypoints).toHaveLength(1)
    expect(references[1]?.waypoints).toEqual([])
  })

  it('falls back from the part name to the file name to the file itself', () => {
    const named = referencesOf(file(), 'alpencross.gpx', new Set())
    expect(named[0]?.name).toBe('Day 3')

    const unnamedPart = referencesOf(
      file({
        parts: [
          { kind: 'track', name: null, sportRaw: null, points: [point(47, 11), point(47.1, 11)] },
        ],
      }),
      'alpencross.gpx',
      new Set(),
    )
    expect(unnamedPart[0]?.name).toBe('Alpencross')

    const nothing = referencesOf(
      file({
        name: null,
        parts: [
          { kind: 'track', name: null, sportRaw: null, points: [point(47, 11), point(47.1, 11)] },
        ],
      }),
      'alpencross.gpx.gz',
      new Set(),
    )
    // The extension is not part of the name, gzipped or otherwise.
    expect(nothing[0]?.name).toBe('alpencross')
  })

  it('keeps a route marked as one, because its line cuts corners', () => {
    const references = referencesOf(
      file({
        parts: [
          {
            kind: 'route',
            name: 'Timmelsjoch',
            sportRaw: null,
            points: [point(47, 11), point(47.1, 11)],
          },
        ],
      }),
      'route.gpx',
      new Set(),
    )

    expect(references[0]?.kind).toBe('route')
  })

  it('thins the points and measures the line it actually draws', () => {
    const straight = Array.from({ length: 200 }, (_, i) => point(47 + i * 0.0001, 11))
    const references = referencesOf(
      file({ parts: [{ kind: 'track', name: 'Straight', sportRaw: null, points: straight }] }),
      'straight.gpx',
      new Set(),
    )

    // Douglas-Peucker keeps the ends of a straight run and nothing between them.
    expect(references[0]?.points.length).toBeLessThan(straight.length)
    // ~0.0199 degrees of latitude, which is a bit over 2 km.
    expect(references[0]?.distanceM).toBeGreaterThan(2000)
    expect(references[0]?.distanceM).toBeLessThan(2300)
  })
})

describe('the colour a reference gets', () => {
  it('never lands on the slot that looks like the plan', () => {
    // Slot 0 is #0a6b48 against the plan's #0d8a5f: close enough to read as the route
    // you are drawing rather than one you are drawing against.
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']) {
      expect(slotFor(name, new Set())).not.toBe(0)
    }
  })

  it('probes past a slot already on screen', () => {
    const first = slotFor('Day 3', new Set())
    expect(slotFor('Day 3', new Set([first]))).not.toBe(first)
  })

  it('gives the same file the same colour when it is dropped again', () => {
    const once = referencesOf(file(), 'alpencross.gpx', new Set())
    const again = referencesOf(file(), 'alpencross.gpx', new Set())

    expect(again[0]?.colour).toBe(once[0]?.colour)
    expect(once[0]?.colour).toBe(colourForSlot(once[0]!.slot))
  })

  it('gives two parts of one file two colours', () => {
    const references = referencesOf(
      file({
        parts: [
          {
            kind: 'track',
            name: 'Day 3',
            sportRaw: null,
            points: [point(47, 11), point(47.1, 11)],
          },
          {
            kind: 'track',
            name: 'Day 3',
            sportRaw: null,
            points: [point(47.1, 11), point(47.2, 11)],
          },
        ],
      }),
      'alpencross.gpx',
      new Set(),
    )

    // Same name, so the same preferred slot — the probe is what separates them.
    expect(references[0]?.slot).not.toBe(references[1]?.slot)
  })
})
