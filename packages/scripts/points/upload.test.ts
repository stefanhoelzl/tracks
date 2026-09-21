import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { Manifest } from './tiles.ts'
import { MANIFEST, plan, upload } from './upload.ts'

describe('what an upload sends', () => {
  it('is what is new or changed, and deletes what is gone', () => {
    const remote = { 'a.pbf': '1', 'b.pbf': '2', 'gone.pbf': '3' }
    const local = { 'a.pbf': '1', 'b.pbf': 'changed', 'new.pbf': '4' }
    expect(plan(local, remote)).toEqual({ put: ['b.pbf', 'new.pbf'], remove: ['gone.pbf'] })
  })
})

/** A storage zone in memory, answering the way Bunny's storage API does. */
function zone(initial: Record<string, Uint8Array> = {}, flaky: Set<string> = new Set()) {
  const files = new Map(Object.entries(initial))
  const log: string[] = []
  const fake = (async (url: string, init?: RequestInit) => {
    const path = url.replace('https://storage.bunnycdn.com/z/', '')
    const method = init?.method ?? 'GET'
    const headers = init?.headers as Record<string, string>
    if (headers.AccessKey !== 'pw') return new Response('', { status: 401 })
    log.push(`${method} ${path}`)
    if (flaky.delete(`${method} ${path}`)) return new Response('busy', { status: 503 })
    if (method === 'GET') {
      const body = files.get(path)
      return body ? new Response(body) : new Response('', { status: 404 })
    }
    if (method === 'PUT') {
      files.set(path, new Uint8Array(init?.body as Uint8Array))
      return new Response('', { status: 201 })
    }
    files.delete(path)
    return new Response('', { status: 200 })
  }) as unknown as typeof fetch
  return { files, log, fake }
}

function tree(tiles: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'points-upload-'))
  const hashes: Record<string, string> = {}
  for (const [path, content] of Object.entries(tiles)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
    hashes[path] = `h-${content}`
  }
  const manifest: Manifest = { version: 1, planet: 'planet-260914', built: 'now', tiles: hashes }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
  return dir
}

const readManifest = (bytes: Uint8Array | undefined) =>
  JSON.parse(gunzipSync(bytes ?? new Uint8Array()).toString('utf8')) as Manifest

const options = (fake: typeof fetch) => ({
  zone: 'z',
  password: 'pw',
  fetch: fake,
  log: () => {},
  backoff: () => 0,
})

describe('an upload', () => {
  it('sends everything to an empty zone, and writes the manifest last', async () => {
    const { files, log, fake } = zone()
    await upload(tree({ 'outdoor/9/1/2.pbf': 'x', 'town/12/3/4.pbf': 'y' }), options(fake))
    expect(log.at(-1)).toBe(`PUT ${MANIFEST}`)
    expect(new TextDecoder().decode(files.get('outdoor/9/1/2.pbf'))).toBe('x')
    expect(readManifest(files.get(MANIFEST)).tiles).toEqual({
      'outdoor/9/1/2.pbf': 'h-x',
      'town/12/3/4.pbf': 'h-y',
    })
  })

  it('leaves what is unchanged alone, and deletes what no longer exists', async () => {
    const previous: Manifest = {
      version: 1,
      planet: 'planet-260817',
      built: 'then',
      tiles: { 'outdoor/9/1/2.pbf': 'h-x', 'outdoor/9/5/5.pbf': 'h-old' },
    }
    const { log, fake } = zone({ [MANIFEST]: gzipSync(JSON.stringify(previous)) })
    await upload(tree({ 'outdoor/9/1/2.pbf': 'x', 'outdoor/9/7/7.pbf': 'z' }), options(fake))
    expect(log).toEqual([
      `GET ${MANIFEST}`,
      'PUT outdoor/9/7/7.pbf',
      'DELETE outdoor/9/5/5.pbf',
      `PUT ${MANIFEST}`,
    ])
  })

  it('retries what the zone was too busy for', async () => {
    const { files, fake } = zone({}, new Set(['PUT outdoor/9/1/2.pbf']))
    await upload(tree({ 'outdoor/9/1/2.pbf': 'x' }), options(fake))
    expect(files.has('outdoor/9/1/2.pbf')).toBe(true)
  })

  it('checkpoints the manifest with only what has landed', async () => {
    const { files, log, fake } = zone()
    const tiles = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`outdoor/9/${i}/0.pbf`, `${i}`]),
    )
    await upload(tree(tiles), { ...options(fake), concurrency: 1, checkpointEvery: 2 })
    const manifestWrites = log.filter((line) => line === `PUT ${MANIFEST}`)
    // Two checkpoints (after 2 and 4 tiles) and the final one.
    expect(manifestWrites).toHaveLength(3)
    expect(Object.keys(readManifest(files.get(MANIFEST)).tiles)).toHaveLength(5)
  })

  it('stops at once when the zone refuses the password', async () => {
    const { fake } = zone()
    await expect(
      upload(tree({ 'outdoor/9/1/2.pbf': 'x' }), { ...options(fake), password: 'wrong' }),
    ).rejects.toThrow(/401/)
  })
})
