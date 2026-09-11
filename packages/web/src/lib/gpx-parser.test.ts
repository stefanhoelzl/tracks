import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { through } from '../sources/strava-zip/gzip.ts'
import { parseTrackBytes, parseTrackStream } from './gpx-parser.ts'

/**
 * Real files for the shapes that exist in the wild, inline strings for the broken ones.
 *
 * A hand-written GPX is a GPX somebody imagined: it will not have the prefixed
 * namespace, the second `<trkseg>` or the whitespace before a TCX prolog that real
 * exporters produce. A file whose whole point is being malformed reads better next to
 * the assertion about it.
 */
const GPX = resolve(import.meta.dirname, '../../../../fixtures/gpx')
const ARCHIVE = resolve(import.meta.dirname, '../../../../fixtures/strava-archive')

const parse = async (dir: string, name: string) =>
  parseTrackBytes(name, new Uint8Array(await readFile(resolve(dir, name))))

const inline = (name: string, xml: string) => parseTrackBytes(name, new TextEncoder().encode(xml))

/** The fixtures are committed as plain text; a real export gzips them. So does this. */
const gzipped = async (dir: string, name: string) =>
  through(new Uint8Array(await readFile(resolve(dir, name))), new CompressionStream('gzip'))

describe('what a file contains', () => {
  it('reads every <trk> as its own part, with its segments joined', async () => {
    const file = await parse(GPX, 'alpencross.gpx')

    expect(file.name).toBe('Alpencross 2026')
    expect(file.parts.map((part) => part.name)).toEqual([
      'Day 3 — Reschen to Schlinig',
      'Day 4 — Schlinig to Taufers',
    ])
    // Two <trkseg> in the first track, joined: a recording that paused is one line.
    expect(file.parts[0]?.points).toHaveLength(5)
    expect(file.parts[1]?.points).toHaveLength(2)
    expect(file.parts[0]?.kind).toBe('track')
    expect(file.parts[0]?.sportRaw).toBe('touringbicycle')
  })

  it('keeps <wpt>s at their own coordinates, with their own names', async () => {
    const file = await parse(GPX, 'alpencross.gpx')

    expect(file.waypoints).toEqual([
      { lat: 46.9012, lon: 10.8701, name: 'Sesvennahütte' },
      { lat: 46.8455, lon: 10.7712, name: 'Schlinig' },
    ])
  })

  it('does not let a <wpt> name become the track name, or the file name', async () => {
    // The bug `directChild` existed to prevent in the DOM version: <trk><name>,
    // <wpt><name> and <metadata><name> are all `name`, and only the stack tells them
    // apart.
    const file = await parse(GPX, 'alpencross.gpx')

    expect(file.name).toBe('Alpencross 2026')
    expect(file.parts[0]?.name).toBe('Day 3 — Reschen to Schlinig')
  })

  it('reads a <rte> as a part, marked as one', async () => {
    const file = await parse(GPX, 'route-only.gpx')

    expect(file.parts).toHaveLength(1)
    expect(file.parts[0]?.kind).toBe('route')
    expect(file.parts[0]?.name).toBe('Timmelsjoch')
    expect(file.parts[0]?.points).toHaveLength(3)
    // A rtept's own <name> is not a waypoint: it is a point on the route.
    expect(file.waypoints).toEqual([])
  })

  it('parses a document that declares its namespace with a prefix', async () => {
    const file = await parse(GPX, 'prefixed-namespace.gpx')

    expect(file.parts[0]?.name).toBe('Karwendel')
    expect(file.parts[0]?.points).toHaveLength(2)
  })
})

describe('the formats it accepts', () => {
  it('parses a gzipped TCX despite whitespace before the prolog', async () => {
    const file = await parseTrackBytes(
      'activities/1002.tcx.gz',
      await gzipped(ARCHIVE, 'activities/1002.tcx'),
    )
    const part = file.parts[0]

    expect(part?.points).toHaveLength(5) // the 6th sample has Time but no Position
    expect(part?.sportRaw).toBe('Run')
    expect(part?.points[0]?.altitudeM).toBe(520)
    expect(part?.points[0]?.recordedAt).toBe(Math.floor(Date.parse('2020-07-02T16:46:31Z') / 1000))
  })

  it('parses a plain GPX with its type and name', async () => {
    const part = (await parse(ARCHIVE, 'activities/1001.gpx')).parts[0]

    expect(part?.points).toHaveLength(6)
    expect(part?.sportRaw).toBe('running')
    expect(part?.name).toBe('Evening Run')
  })

  it('reports no sport for a third-party GPX with no <type>', async () => {
    const part = (await parse(ARCHIVE, 'activities/9999.gpx')).parts[0]

    expect(part?.sportRaw).toBeNull()
    expect(part?.name).toBe('Almenrunde')
  })

  it('sniffs gzip rather than trusting the name', async () => {
    // Gzipped bytes under a name that claims otherwise: a dropped file is named by
    // whoever made it, so the magic number decides and the extension does not.
    const bytes = await gzipped(ARCHIVE, 'activities/9999.gpx')

    expect((await parseTrackBytes('anything-at-all.xml', bytes)).parts[0]?.name).toBe('Almenrunde')
  })
})

describe('files it refuses, and files it survives', () => {
  it('rejects a file that is not XML at all', async () => {
    await expect(inline('broken.gpx', 'this is not xml')).rejects.toThrow(/parseable XML/)
  })

  it('rejects XML that ends in the middle of a tag', async () => {
    await expect(
      inline('truncated.gpx', '<gpx><trk><trkseg><trkpt lat="47" lon="11">'),
    ).rejects.toThrow(/parseable XML/)
  })

  it('reports a well-formed file with no track at all as having no parts', async () => {
    const file = await inline(
      'empty.gpx',
      '<gpx xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Nothing</name></metadata></gpx>',
    )

    expect(file.parts).toEqual([])
    expect(file.name).toBe('Nothing')
  })

  it('drops a part whose points are all unusable rather than drawing nothing', async () => {
    const file = await inline(
      'no-coords.gpx',
      '<gpx><trk><name>Broken</name><trkseg><trkpt><ele>100</ele></trkpt></trkseg></trk></gpx>',
    )

    expect(file.parts).toEqual([])
  })

  it('skips a point with unusable coordinates instead of putting it at (0, 0)', async () => {
    const file = await inline(
      'partial.gpx',
      `<gpx><trk><trkseg>
         <trkpt lat="47.1" lon="11.1"/>
         <trkpt lat="not-a-number" lon="11.2"/>
         <trkpt lat="47.3" lon="11.3"/>
       </trkseg></trk></gpx>`,
    )

    expect(file.parts[0]?.points.map((point) => point.lat)).toEqual([47.1, 47.3])
  })
})

describe('streaming', () => {
  const streamOf = (xml: string, chunk: number): ReadableStream<Uint8Array> => {
    const bytes = new TextEncoder().encode(xml)
    let at = 0
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (at >= bytes.length) return controller.close()
        controller.enqueue(bytes.slice(at, at + chunk))
        at += chunk
      },
    })
  }

  const xml = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Split</name><trkseg>
      <trkpt lat="47.1" lon="11.1"><ele>900</ele></trkpt>
      <trkpt lat="47.2" lon="11.2"><ele>950</ele></trkpt>
    </trkseg></trk></gpx>`

  it('reads the same file whatever the chunk boundaries fall in the middle of', async () => {
    // Seven bytes at a time splits tags, attributes and text nodes; a streaming parser
    // is chosen precisely so none of that has to be handled here.
    const file = await parseTrackStream('split.gpx', streamOf(xml, 7))

    expect(file.parts[0]?.name).toBe('Split')
    expect(file.parts[0]?.points).toHaveLength(2)
    expect(file.parts[0]?.points[1]?.altitudeM).toBe(950)
  })

  it('reports progress once per chunk, up to the total it was given', async () => {
    const seen: number[] = []
    const total = new TextEncoder().encode(xml).length

    await parseTrackStream('split.gpx', streamOf(xml, 32), {
      totalBytes: total,
      onProgress: (read) => seen.push(read),
    })

    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBe(total)
    // Monotonic, so a progress bar can only go forwards.
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('stops when the signal is aborted', async () => {
    const controller = new AbortController()

    await expect(
      parseTrackStream('split.gpx', streamOf(xml, 4), {
        signal: controller.signal,
        onProgress: () => controller.abort(new Error('cancelled')),
      }),
    ).rejects.toThrow(/cancelled/)
  })
})
