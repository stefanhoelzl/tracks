/**
 * The tile trees onto Bunny Storage, sending only what changed.
 *
 * Bunny takes one request per object and throttles the zone, by an amount that varies: with 128
 * kept-alive connections the first real upload held ~200 objects/s for an hour, a test the same
 * morning got 34/s, and 256 connections collapse to a few per second and drop requests. So the zone
 * holds a manifest of every tile's hash, and a run uploads only what differs from it, deletes what
 * is no longer there, and writes the manifest last.
 *
 * The manifest is also written every `checkpointEvery` tiles along the way, recording only what has
 * actually landed. A run that hits the job's time limit — the first may — then leaves a truthful
 * manifest behind, and the next one carries on from it instead of starting again.
 *
 * Storage is addressed directly, with the zone's own password — not the CDN, which caches, and not
 * Bunny's account API, which this job has no business holding.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { Manifest } from './tiles.ts'

export const MANIFEST = 'manifest.json.gz'

export type UploadOptions = {
  readonly zone: string
  readonly password: string
  /** Bunny's storage hostname for the zone's region; the zone is in Falkenstein. */
  readonly endpoint?: string
  readonly concurrency?: number
  readonly checkpointEvery?: number
  readonly fetch?: typeof fetch
  readonly log?: (line: string) => void
  /** Milliseconds to wait before retry `attempt` (0-based). Tests make it zero. */
  readonly backoff?: (attempt: number) => number
}

export type Plan = { readonly put: string[]; readonly remove: string[] }

/** What to send and what to delete, to turn `remote` into `local`. */
export function plan(
  local: Readonly<Record<string, string>>,
  remote: Readonly<Record<string, string>>,
): Plan {
  const put = Object.keys(local).filter((path) => remote[path] !== local[path])
  const remove = Object.keys(remote).filter((path) => !(path in local))
  return { put: put.sort(), remove: remove.sort() }
}

/** A failure that no retry will fix: the zone refused the password, or the request itself. */
class Fatal extends Error {}

const ATTEMPTS = 6

export async function upload(dir: string, options: UploadOptions): Promise<void> {
  const {
    zone,
    password,
    endpoint = 'storage.bunnycdn.com',
    concurrency = 128,
    checkpointEvery = 50_000,
    fetch: send = fetch,
    log = console.log,
    backoff = (attempt) => Math.min(30_000, 500 * 2 ** attempt),
  } = options
  const base = `https://${endpoint}/${zone}/`

  /**
   * One request, retried, with its answer read to the end.
   *
   * Always read to the end: a response left unread keeps its connection checked out of the pool,
   * so the next request opens a fresh one and pays a TLS handshake to Falkenstein. Measured on a
   * real upload, leaving PUT answers unread held it to 13 objects/s.
   */
  async function request(
    method: 'GET' | 'PUT' | 'DELETE',
    path: string,
    body?: Uint8Array,
  ): Promise<{ status: number; body: Uint8Array }> {
    const headers: Record<string, string> = { AccessKey: password }
    if (body) {
      headers['Content-Type'] = path.endsWith('.pbf')
        ? 'application/x-protobuf'
        : 'application/gzip'
      // Bunny refuses an upload whose bytes do not hash to this, so a truncated body never lands.
      headers.Checksum = createHash('sha256').update(body).digest('hex').toUpperCase()
    }
    for (let attempt = 0; ; attempt++) {
      let response: Response | null = null
      try {
        response = await send(base + path, { method, headers, body: body as RequestInit['body'] })
      } catch (error) {
        if (attempt + 1 >= ATTEMPTS) throw error
      }
      if (response) {
        if (response.ok || (method !== 'PUT' && response.status === 404)) {
          return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) }
        }
        if (response.status === 401 || response.status === 403) {
          throw new Fatal(
            `${method} ${path}: ${response.status}, the storage zone refused the password`,
          )
        }
        const retryable = response.status === 429 || response.status >= 500
        if (!retryable || attempt + 1 >= ATTEMPTS) {
          throw new Error(
            `${method} ${path}: HTTP ${response.status} ${await response.text().catch(() => '')}`,
          )
        }
        await response.body?.cancel()
      }
      await new Promise((resolve) => setTimeout(resolve, backoff(attempt)))
    }
  }

  const local = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
  const found = await request('GET', MANIFEST)
  const remote: Manifest =
    found.status === 404
      ? { version: 1, planet: '', built: '', tiles: {} }
      : (JSON.parse(gunzipSync(found.body).toString('utf8')) as Manifest)

  const { put, remove } = plan(local.tiles, remote.tiles)
  const kept = Object.keys(local.tiles).length - put.length
  log(
    `${put.length.toLocaleString('en')} tiles to send, ${remove.length.toLocaleString('en')} to delete, ` +
      `${kept.toLocaleString('en')} unchanged (zone was ${remote.planet || 'empty'}, now ${local.planet})`,
  )

  // What the zone holds as far as this run knows: the remote manifest, updated as requests succeed.
  const current: Record<string, string> = { ...remote.tiles }
  const writeManifest = async () => {
    const manifest: Manifest = { ...local, tiles: current }
    await request('PUT', MANIFEST, gzipSync(JSON.stringify(manifest)))
  }

  const failed: string[] = []
  async function pool(
    paths: readonly string[],
    work: (path: string) => Promise<void>,
    verb: string,
  ) {
    let next = 0
    let done = 0
    let sinceCheckpoint = 0
    const started = Date.now()
    let checkpointing: Promise<void> = Promise.resolve()
    async function worker() {
      while (next < paths.length) {
        const path = paths[next++] as string
        try {
          await work(path)
        } catch (error) {
          if (error instanceof Fatal) throw error
          failed.push(path)
          log(`  ${verb} failed for good: ${(error as Error).message}`)
        }
        done++
        if (++sinceCheckpoint >= checkpointEvery) {
          sinceCheckpoint = 0
          // Insurance, not the result: a checkpoint that fails is logged and the run goes on, since
          // the manifest is written again at the end regardless.
          checkpointing = checkpointing
            .then(writeManifest)
            .catch((error) => log(`  checkpoint failed, going on: ${(error as Error).message}`))
        }
        if (done % 10_000 === 0 || done === paths.length) {
          const rate = done / ((Date.now() - started) / 1000)
          const left = (paths.length - done) / rate
          log(
            `  ${verb} ${done.toLocaleString('en')}/${paths.length.toLocaleString('en')} — ${rate.toFixed(0)}/s, ${(left / 60).toFixed(0)} min left`,
          )
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker))
    await checkpointing
  }

  await pool(
    put,
    async (path) => {
      await request('PUT', path, readFileSync(join(dir, path)))
      current[path] = local.tiles[path] as string
    },
    'sent',
  )
  await pool(
    remove,
    async (path) => {
      await request('DELETE', path)
      delete current[path]
    },
    'deleted',
  )

  await writeManifest()
  if (failed.length > 0) {
    throw new Error(
      `${failed.length} tiles did not upload; the manifest leaves them for the next run`,
    )
  }
  log('manifest written')
}
