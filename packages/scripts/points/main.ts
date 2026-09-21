/**
 * The map's own points, from QLever's planet to Bunny, in three steps the workflow runs in order.
 *
 *     pnpm points:extract build/points          every rule's objects, asked of QLever
 *     pnpm points:extract build/points 1000     at most 1000 per rule, to try it quickly
 *     pnpm points:tiles build/points            points.ndjson into tiles/ and a manifest
 *     pnpm points:upload build/points           what changed, onto the storage zone
 *
 * Kept apart so a failed upload is retried without asking QLever again, and so a trial run can stop
 * before anything leaves the machine. `upload` needs `TRACKS_STORAGE_ZONE` and
 * `TRACKS_STORAGE_ZONE_PASSWORD` — locally, `secrets-env -- pnpm …`. See
 * `.github/workflows/points.yml` for where it runs, and `packages/web/src/map/points.ts` for what it
 * makes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataset, extract } from './extract.ts'
import { writeTiles } from './tiles.ts'
import { upload } from './upload.ts'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const [command, dir, arg] = process.argv.slice(2)
if (!dir) throw new Error('usage: main.ts <extract|tiles|upload> <work-dir> …')

switch (command) {
  case 'extract': {
    mkdirSync(dir, { recursive: true })
    const planet = await dataset()
    console.log(`QLever serves ${planet}`)
    await extract(join(dir, 'points.ndjson'), arg ? { limit: Number(arg) } : {})
    writeFileSync(join(dir, 'planet.txt'), `${planet}\n`)
    break
  }
  case 'tiles': {
    const planet = readFileSync(join(dir, 'planet.txt'), 'utf8').trim()
    await writeTiles(join(dir, 'points.ndjson'), join(dir, 'tiles'), planet)
    break
  }
  case 'upload': {
    const concurrency = Number(process.env.POINTS_UPLOAD_CONCURRENCY) || undefined
    await upload(join(dir, 'tiles'), {
      zone: env('TRACKS_STORAGE_ZONE'),
      password: env('TRACKS_STORAGE_ZONE_PASSWORD'),
      ...(concurrency ? { concurrency } : {}),
    })
    break
  }
  default:
    throw new Error('usage: main.ts <extract|tiles|upload> <work-dir> …')
}
