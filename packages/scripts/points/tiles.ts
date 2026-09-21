/**
 * Points into the two tile trees, gzipped, with a manifest of what was written.
 *
 * Every point goes into every zoom its source stores — `outdoor` at z9, z10 and z11, `town` at z12 —
 * so a tile holds everything and the style's `minzoom` decides what is painted. Only tiles with
 * something in them are written: the trees are sparse, and an absent tile is a 404 that MapLibre
 * reads as empty, on the web and in the phone's offline packs alike.
 *
 * The manifest maps each tile's path to a hash of its bytes. It is how the upload tells what changed
 * since last month without asking Bunny about 700k objects, and it is uploaded last.
 */
import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { gzipSync } from 'node:zlib'
import {
  POINT_SOURCES,
  POINTS_EXTENT,
  POINTS_LAYER,
  type PointSource,
} from '../../web/src/map/points.ts'
import type { Point } from './features.ts'
import { encodeTile, type TilePoint } from './mvt.ts'

/** Web Mercator's limit: past it a latitude has no tile. */
const MAX_LAT = 85.0511287798

/** The tile a point falls in at `z`, and its position inside that tile in MVT units. */
export function tileOf(
  lon: number,
  lat: number,
  z: number,
  extent = POINTS_EXTENT,
): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  const phi = (clamped * Math.PI) / 180
  const fx = ((lon + 180) / 360) * n
  const fy = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n
  const x = Math.min(n - 1, Math.max(0, Math.floor(fx)))
  const y = Math.min(n - 1, Math.max(0, Math.floor(fy)))
  const px = Math.min(extent - 1, Math.max(0, Math.floor((fx - x) * extent)))
  const py = Math.min(extent - 1, Math.max(0, Math.floor((fy - y) * extent)))
  return { x, y, px, py }
}

export type Tile = { readonly path: string; readonly body: Uint8Array }

/** Every non-empty tile of one source at one zoom, gzipped and ready to serve. */
export function* tilesAt(
  points: readonly Point[],
  source: PointSource,
  z: number,
): Generator<Tile> {
  const buckets = new Map<string, TilePoint[]>()
  for (const point of points) {
    const { x, y, px, py } = tileOf(point.lon, point.lat, z)
    const key = `${x}/${y}`
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = []
      buckets.set(key, bucket)
    }
    bucket.push({ x: px, y: py, kind: point.kind, name: point.name, ele: point.ele })
  }
  const prefix = POINT_SOURCES[source].path
  // Sorted, so the tree and the manifest come out in the same order every run.
  for (const key of [...buckets.keys()].sort()) {
    const raw = encodeTile(POINTS_LAYER, buckets.get(key) ?? [], POINTS_EXTENT)
    yield { path: `${prefix}/${z}/${key}.pbf`, body: gzipSync(raw, { level: 9 }) }
  }
}

/** 64 bits of SHA-256: enough to tell a changed tile from an unchanged one, and half the size. */
export function tileHash(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 16)
}

export type Manifest = {
  readonly version: 1
  /** The planet file the tiles were cut from, for whoever wonders how old they are. */
  readonly planet: string
  readonly built: string
  readonly tiles: Readonly<Record<string, string>>
}

async function readPoints(file: string): Promise<Record<PointSource, Point[]>> {
  const bySource: Record<PointSource, Point[]> = { outdoor: [], town: [] }
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line) continue
    const point = JSON.parse(line) as Point
    bySource[point.source].push(point)
  }
  return bySource
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
}

/**
 * Cuts `points.ndjson` into `outDir/<source>/<z>/<x>/<y>.pbf` and writes `outDir/manifest.json`.
 *
 * Logs what each zoom came to, which is also what the workflow's run shows: tile count, size and
 * the spread of tile sizes, since one oversized tile is the thing to notice.
 */
export async function writeTiles(
  pointsFile: string,
  outDir: string,
  planet: string,
): Promise<Manifest> {
  const bySource = await readPoints(pointsFile)
  const tiles: Record<string, string> = {}
  const made = new Set<string>()
  for (const source of Object.keys(POINT_SOURCES) as PointSource[]) {
    const { minzoom, maxzoom } = POINT_SOURCES[source]
    const points = bySource[source]
    console.log(`${source}: ${points.length.toLocaleString('en')} points`)
    for (let z = minzoom; z <= maxzoom; z++) {
      const started = Date.now()
      const sizes: number[] = []
      for (const tile of tilesAt(points, source, z)) {
        const file = join(outDir, tile.path)
        const dir = dirname(file)
        if (!made.has(dir)) {
          mkdirSync(dir, { recursive: true })
          made.add(dir)
        }
        writeFileSync(file, tile.body)
        tiles[tile.path] = tileHash(tile.body)
        sizes.push(tile.body.length)
      }
      sizes.sort((a, b) => a - b)
      const total = sizes.reduce((sum, n) => sum + n, 0)
      console.log(
        `  z${z}: ${sizes.length.toLocaleString('en')} tiles, ${(total / 1e6).toFixed(1)} MB, ` +
          `median ${quantile(sizes, 0.5)} B, p95 ${quantile(sizes, 0.95)} B, ` +
          `max ${sizes.at(-1) ?? 0} B (${((Date.now() - started) / 1000).toFixed(1)}s)`,
      )
    }
  }
  const manifest: Manifest = { version: 1, planet, built: new Date().toISOString(), tiles }
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest)}\n`)
  return manifest
}
