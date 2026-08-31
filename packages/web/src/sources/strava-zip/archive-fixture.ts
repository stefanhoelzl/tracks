import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { BlobWriter, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
import { through } from './gzip.ts'

/**
 * Builds a throwaway export zip from the plain-text fixtures.
 *
 * A real export is a zip containing gzipped files, and the importer must handle both —
 * but committing binary blobs would make the fixtures unreviewable and undiffable. So
 * the fixtures stay plain text and the zip, plus the `.gz` entries the CSV references,
 * are produced here at test time.
 *
 * Test-only, so reading the fixtures from disk with `node:fs` is fine; nothing in the
 * shipped browser code touches a filesystem.
 */
export async function materializeArchive(fixtureRoot: string, prefix = ''): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  const csv = readFileSync(join(fixtureRoot, 'activities.csv'))

  await writer.add(`${prefix}activities.csv`, new Uint8ArrayReader(csv))

  for (const referenced of new TextDecoder().decode(csv).matchAll(/activities\/[\w.-]+/g)) {
    const target = referenced[0]
    const name = basename(target)

    // e.g. the CSV points at 1002.tcx.gz; the fixture on disk is 1002.tcx.
    const plain = name.endsWith('.gz') ? name.slice(0, -'.gz'.length) : name
    const bytes = readFileSync(join(fixtureRoot, 'activities', plain))

    await writer.add(
      `${prefix}${target}`,
      new Uint8ArrayReader(name.endsWith('.gz') ? await gzip(bytes) : bytes),
    )
  }

  return writer.close()
}

const gzip = (bytes: Uint8Array) => through(bytes, new CompressionStream('gzip'))
