#!/usr/bin/env node
import { resolve } from 'node:path'
import type { ActivitySource } from '@tracks/core'
import { Command } from 'commander'
import { openDb } from './db.ts'
import { importSource } from './import.ts'
import { KomootSource } from './sources/komoot/index.ts'
import { StravaArchiveSource } from './sources/strava-archive/index.ts'

const DATA_DIR = process.env.TRACKS_DATA_DIR ?? resolve('data')

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Komoot credentials come from your password manager:\n` +
        '  proton-env -- pnpm tracks import komoot',
    )
  }
  return value
}

/** `komoot` names a live source; anything else is a path to a Strava export. */
function resolveSource(target: string): ActivitySource {
  if (target === 'komoot') {
    return new KomootSource({
      email: required('KOMOOT_EMAIL'),
      password: required('KOMOOT_PASSWORD'),
      rawDir: resolve(DATA_DIR, 'raw'),
    })
  }
  return new StravaArchiveSource(resolve(target))
}

const program = new Command()
program.name('tracks').description('Map, tag and count your Strava and Komoot activities')

program
  .command('import')
  .description('Import from a Strava export directory, or from Komoot')
  .argument('<target>', "path to an unpacked Strava export, or 'komoot'")
  .action(async (target: string) => {
    const { db, close } = openDb(resolve(DATA_DIR, 'tracks.db'))
    try {
      const result = await importSource(db, resolveSource(target))
      console.log(
        `${result.imported} imported, ${result.unchanged} unchanged, ` +
          `${result.skippedNoTrack} without a track, ${result.failed.length} failed ` +
          `(${result.seen} seen)`,
      )
      // A source's vocabulary is a fact, so a value the registry had lost comes back
      // rather than costing a tag — but never silently.
      for (const tag of result.readdedValues) {
        console.log(`  re-added ${tag} to the registry`)
      }
      for (const [tag, count] of result.rejectedTags) {
        console.log(`  ${count} derived tags rejected: ${tag} is not in the registry`)
      }
      for (const failure of result.failed) {
        console.error(`  ${failure.externalId}: ${failure.error}`)
      }
      if (result.failed.length > 0) process.exitCode = 1
    } finally {
      close()
    }
  })

program.parseAsync().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
