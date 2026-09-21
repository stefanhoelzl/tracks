/**
 * The points of the whole planet, asked of QLever.
 *
 * QLever (qlever.dev, University of Freiburg) holds the OSM planet as RDF, with every node, way and
 * relation's geometry already assembled as WKT. That settles the one hard part of cutting the planet
 * ourselves: a way's coordinates live on its nodes, which a planet file stores before the ways, so
 * a single read of a 95 GB stream cannot give a building its shape. Here a way arrives with its
 * polygon, and so does a multipolygon relation. One query per rule, generated from `points.ts`, is
 * about fifteen minutes and a gigabyte for the whole planet.
 *
 * It is a research service with no promises attached, which shapes two things. A failed request
 * fails the run, and the zone keeps last month's tiles. And a query that runs but returns nothing —
 * what a change to QLever's schema looks like from here — fails it too: every kind has thousands of
 * features on the planet, so an empty one is a broken query, never a fact about the world.
 *
 * Its planet is whatever QLever last imported — a few weeks old — which for peaks and fountains is
 * no loss. The dataset's name is kept in the manifest.
 */
import { createWriteStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { POINT_RULES, type PointRule } from '../../web/src/map/points.ts'
import { pointOf } from './features.ts'

export const ENDPOINT = 'https://qlever.dev/api/osm-planet'
const USER_AGENT = 'tracks points (+https://github.com/stefanhoelzl/tracks)'

const KEY = (key: string) => `<https://www.openstreetmap.org/wiki/Key:${key}>`
const literal = (value: string) => JSON.stringify(value)

/** The query for one rule: every object it selects, with its geometry, name and height. */
export function query(rule: PointRule, limit?: number): string {
  const also = Object.entries(rule.also ?? {}).map(([k, v]) => `?s ${KEY(k)} ${literal(v)} .`)
  const unless = Object.entries(rule.unless ?? {}).map(
    ([k, v]) => `FILTER NOT EXISTS { ?s ${KEY(k)} ${literal(v)} }`,
  )
  return [
    'PREFIX geo: <http://www.opengis.net/ont/geosparql#>',
    'SELECT ?s ?wkt ?name ?ele WHERE {',
    `  ?s ${KEY(rule.tag[0])} ${literal(rule.tag[1])} .`,
    ...also.map((line) => `  ${line}`),
    ...unless.map((line) => `  ${line}`),
    '  ?s geo:hasGeometry/geo:asWKT ?wkt .',
    `  OPTIONAL { ?s ${KEY('name')} ?name }`,
    `  OPTIONAL { ?s ${KEY('ele')} ?ele }`,
    `}${limit ? ` LIMIT ${limit}` : ''}`,
  ].join('\n')
}

/**
 * One field of QLever's TSV as a plain string, or undefined when it is unbound.
 *
 * An IRI comes in angle brackets, a literal in quotes — unescaped inside, so a name like
 * `"Campingplatz "Blaue Adria""` is unwrapped from its first quote to its last — optionally followed
 * by a datatype. A plain WKT or number may come bare.
 */
export function field(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === '') return undefined
  if (raw.startsWith('<') && raw.endsWith('>')) return raw.slice(1, -1)
  const quoted = /^"(.*)"(?:\^\^<[^>]*>|@[A-Za-z-]+)?$/s.exec(raw)
  return quoted ? quoted[1] : raw
}

/**
 * An OSM object's IRI as one number, for remembering which objects an earlier rule took.
 *
 * Nodes, ways and relations number separately; ×4 plus the type keeps them apart, and the planet's
 * largest ids times four are still well inside a double's exact range. A set of numbers, not
 * strings, because on the planet it holds fourteen million of them.
 */
export function objectKey(iri: string): number | null {
  const found = /\/(node|way|relation)\/(\d+)$/.exec(iri)
  if (!found?.[1] || !found[2]) return null
  return Number(found[2]) * 4 + (found[1] === 'node' ? 0 : found[1] === 'way' ? 1 : 2)
}

/** The planet QLever serves, as named in its index: `planet-260824`. */
export async function dataset(send: typeof fetch = fetch): Promise<string> {
  const response = await send(`${ENDPOINT}?cmd=stats`, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`QLever stats: HTTP ${response.status}`)
  const stats = (await response.json()) as { 'name-index'?: string }
  return /planet-\d+/.exec(stats['name-index'] ?? '')?.[0] ?? 'qlever'
}

export type ExtractOptions = {
  /** At most this many objects per rule: a quick trial, not the planet. */
  readonly limit?: number
  readonly fetch?: typeof fetch
  readonly log?: (line: string) => void
}

const seconds = (since: number) => `${((Date.now() - since) / 1000).toFixed(0)}s`

/**
 * Every rule's objects into `outFile`, one point per line, and how many each kind came to.
 *
 * Rules are asked in priority order and an object is kept by the first that selects it, so a hut
 * also tagged as a shelter is a hut. Asked one after another rather than all at once: this is
 * someone else's machine.
 */
export async function extract(
  outFile: string,
  options: ExtractOptions = {},
): Promise<Record<string, number>> {
  const { limit, fetch: send = fetch, log = console.log } = options
  const out = createWriteStream(outFile)
  const taken = new Set<number>()
  const counts: Record<string, number> = {}
  const started = Date.now()

  for (const rule of POINT_RULES) {
    const t = Date.now()
    const response = await send(`${ENDPOINT}?query=${encodeURIComponent(query(rule, limit))}`, {
      headers: { Accept: 'text/tab-separated-values', 'User-Agent': USER_AGENT },
    })
    if (!response.ok || !response.body) {
      throw new Error(`QLever, ${rule.kind}: HTTP ${response.status} ${await response.text()}`)
    }
    let header = true
    let rows = 0
    let kept = 0
    const lines = createInterface({
      input: Readable.fromWeb(response.body as never),
      crlfDelay: Infinity,
    })
    for await (const line of lines) {
      if (header) {
        header = false
        continue
      }
      if (!line) continue
      rows++
      const [s, wkt, name, ele] = line.split('\t')
      const key = objectKey(field(s) ?? '')
      if (key === null || taken.has(key)) continue
      const point = pointOf(rule, field(wkt) ?? '', field(name), field(ele))
      if (!point) continue
      taken.add(key)
      kept++
      if (!out.write(`${JSON.stringify(point)}\n`)) {
        await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      }
    }
    if (rows === 0) {
      throw new Error(
        `QLever returned no ${rule.kind} at all — its schema has probably changed; nothing was uploaded`,
      )
    }
    counts[rule.kind] = kept
    log(`  ${rule.kind.padEnd(18)} ${kept.toLocaleString('en').padStart(11)}  (${seconds(t)})`)
  }

  await new Promise<void>((resolve, reject) =>
    out.end((error?: Error | null) => (error ? reject(error) : resolve())),
  )
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  log(`${total.toLocaleString('en')} points in ${seconds(started)}`)
  return counts
}
