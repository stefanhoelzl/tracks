import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { gzipSync } from 'node:zlib'

/**
 * Builds a throwaway Strava archive from the plain-text fixtures.
 *
 * A real export contains gzipped files, and the importer must handle them — but
 * committing binary blobs would make the fixtures unreviewable and undiffable. So
 * the fixtures stay plain text and the `.gz` variants the CSV references are
 * produced here, at test time.
 *
 * Returns the path to the materialized archive.
 */
export function materializeArchive(fixtureRoot: string): string {
  const dest = mkdtempSync(join(tmpdir(), 'tracks-archive-'))
  mkdirSync(join(dest, 'activities'), { recursive: true })

  const csv = readFileSync(join(fixtureRoot, 'activities.csv'), 'utf8')
  writeFileSync(join(dest, 'activities.csv'), csv)

  for (const referenced of csv.matchAll(/activities\/[\w.-]+/g)) {
    const target = referenced[0]
    const name = basename(target)

    if (name.endsWith('.gz')) {
      // e.g. the CSV points at 1002.tcx.gz; the fixture on disk is 1002.tcx.
      const plain = join(fixtureRoot, 'activities', name.slice(0, -'.gz'.length))
      writeFileSync(join(dest, target), gzipSync(readFileSync(plain)))
    } else {
      copyFileSync(join(fixtureRoot, 'activities', name), join(dest, target))
    }
  }

  return dest
}
