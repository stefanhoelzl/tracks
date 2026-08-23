#!/usr/bin/env node
import { resolve } from 'node:path'
import { Command } from 'commander'
import { openDb } from './db.ts'
import { importSource } from './import.ts'
import { StravaArchiveSource } from './sources/strava-archive/index.ts'

const DATA_DIR = process.env.TRACKS_DATA_DIR ?? resolve('data')

const program = new Command()
program.name('tracks').description('Map, tag and count your Strava and Komoot activities')

program
  .command('import')
  .description('Import a Strava bulk export directory')
  .argument('<path>', 'path to the unpacked archive')
  .action(async (path: string) => {
    const { db, close } = openDb(resolve(DATA_DIR, 'tracks.db'))
    try {
      const source = new StravaArchiveSource(resolve(path))
      // rawDir stays wired so a source that DOES implement archiveRaw — Komoot,
      // whose undocumented API cannot be cheaply re-read — archives with no further
      // changes here.
      const result = await importSource(db, source, { rawDir: resolve(DATA_DIR, 'raw') })

      console.log(
        `${result.imported} imported, ${result.unchanged} unchanged, ` +
          `${result.skippedNoTrack} without a track, ${result.failed.length} failed ` +
          `(${result.seen} seen)`,
      )
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
