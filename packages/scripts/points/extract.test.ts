import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { POINT_RULES } from '../../web/src/map/points.ts'
import { ENDPOINT, extract, field, objectKey, query } from './extract.ts'

const rule = (kind: string) => {
  const found = POINT_RULES.find((r) => r.kind === kind)
  if (!found) throw new Error(`no rule ${kind}`)
  return found
}

describe('the query for a rule', () => {
  it('selects by the rule’s tag and asks for geometry, name and height', () => {
    const q = query(rule('peak'))
    expect(q).toContain('?s <https://www.openstreetmap.org/wiki/Key:natural> "peak" .')
    expect(q).toContain('?s geo:hasGeometry/geo:asWKT ?wkt .')
    expect(q).toContain('OPTIONAL { ?s <https://www.openstreetmap.org/wiki/Key:ele> ?ele }')
    expect(q).not.toContain('LIMIT')
  })

  it('requires what the rule also needs, and rules out what it excludes', () => {
    expect(query(rule('spring'))).toContain(
      '?s <https://www.openstreetmap.org/wiki/Key:drinking_water> "yes" .',
    )
    expect(query(rule('shelter'))).toContain(
      'FILTER NOT EXISTS { ?s <https://www.openstreetmap.org/wiki/Key:shelter_type> "public_transport" }',
    )
    expect(query(rule('peak'), 10)).toMatch(/} LIMIT 10$/)
  })
})

describe('a field of QLever’s TSV', () => {
  it('unwraps IRIs, literals and typed literals, and keeps inner quotes as they are', () => {
    expect(field('<https://www.openstreetmap.org/node/1>')).toBe(
      'https://www.openstreetmap.org/node/1',
    )
    expect(field('"Mount Kigali"')).toBe('Mount Kigali')
    expect(field('"Campingplatz "Blaue Adria""')).toBe('Campingplatz "Blaue Adria"')
    expect(
      field('"POLYGON((0 0,1 0,1 1,0 0))"^^<http://www.opengis.net/ont/geosparql#wktLiteral>'),
    ).toBe('POLYGON((0 0,1 0,1 1,0 0))')
    expect(field('POINT(1 2)')).toBe('POINT(1 2)')
    expect(field('')).toBeUndefined()
  })

  it('names each OSM object by one number, nodes, ways and relations apart', () => {
    const at = (type: string, id: number) =>
      objectKey(`https://www.openstreetmap.org/${type}/${id}`)
    expect(new Set([at('node', 7), at('way', 7), at('relation', 7)]).size).toBe(3)
    expect(at('node', 13_000_000_000)).toBe(52_000_000_000)
    expect(objectKey('https://example.org/other')).toBeNull()
  })
})

/** QLever, answering each rule's query from a table of TSV bodies keyed by the rule's selecting tag. */
function qlever(answers: Record<string, string[]>) {
  return (async (url: string) => {
    const q = decodeURIComponent(url.slice(`${ENDPOINT}?query=`.length))
    const tag = /Key:(\w+)> "([^"]+)"/.exec(q)
    const rows = answers[`${tag?.[1]}=${tag?.[2]}`] ?? [
      '<https://www.openstreetmap.org/node/999999>\tPOINT(0 0)\t\t',
    ]
    return new Response(['?s\t?wkt\t?name\t?ele', ...rows].join('\n'))
  }) as unknown as typeof fetch
}

describe('an extract', () => {
  const out = () => join(mkdtempSync(join(tmpdir(), 'points-extract-')), 'points.ndjson')
  const read = (file: string) =>
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

  it('keeps an object by the first rule that selects it', async () => {
    const hut =
      '<https://www.openstreetmap.org/way/42>\t"POLYGON((0 0,2 0,2 2,0 2,0 0))"\t"Hütte"\t'
    const file = out()
    await extract(file, {
      log: () => {},
      fetch: qlever({ 'tourism=alpine_hut': [hut], 'amenity=shelter': [hut] }),
    })
    const huts = read(file).filter((p) => p.name === 'Hütte')
    expect(huts).toEqual([{ lon: 1, lat: 1, kind: 'alpine_hut', source: 'outdoor', name: 'Hütte' }])
  })

  it('fails, and writes nothing to upload, when a kind comes back empty', async () => {
    await expect(
      extract(out(), { log: () => {}, fetch: qlever({ 'natural=peak': [] }) }),
    ).rejects.toThrow(/no peak at all/)
  })
})

describe('the priority between rules', () => {
  it('makes a pass that is also tagged a saddle a pass', () => {
    const kinds = POINT_RULES.map((r) => r.kind as string)
    expect(kinds.indexOf('pass')).toBeLessThan(kinds.indexOf('saddle'))
  })
})
