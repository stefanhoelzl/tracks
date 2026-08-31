import { BlobReader, type FileEntry, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js'

/**
 * The export zip, indexed but not unpacked.
 *
 * zip.js reads the central directory off the end of the `File` with range reads, so
 * opening a 500 MB export costs a few KB. Every entry after that is pulled by name and
 * inflated on its own — which matters because the importer touches exactly two things,
 * `activities.csv` and the paths named in its column 12. Photos, comments, followers,
 * clubs and routes are never read off disk, let alone decompressed.
 *
 * Nothing is written anywhere. The zip stays the file the user picked.
 */
export class Archive {
  #entries: Map<string, FileEntry>
  /** Exports are sometimes wrapped in a single top-level folder; this is it. */
  #prefix: string

  private constructor(entries: Map<string, FileEntry>, prefix: string) {
    this.#entries = entries
    this.#prefix = prefix
  }

  static async open(file: Blob): Promise<Archive> {
    const reader = new ZipReader(new BlobReader(file))
    const entries = new Map<string, FileEntry>()
    for (const entry of await reader.getEntries()) {
      if (!entry.directory) entries.set(entry.filename, entry)
    }

    // The archive root is wherever activities.csv is — exports are sometimes wrapped in
    // a folder named after the download. Nothing structural separates that folder from
    // any other, so the shallowest activities.csv wins, which is the root by definition.
    const csv = [...entries.keys()]
      .filter((name) => name === 'activities.csv' || name.endsWith('/activities.csv'))
      .sort((a, b) => a.length - b.length)[0]

    if (csv === undefined) {
      throw new Error('that zip has no activities.csv — is it a Strava export?')
    }

    return new Archive(entries, csv.slice(0, csv.length - 'activities.csv'.length))
  }

  /** Null when the CSV names a file the export does not actually carry. */
  async read(path: string): Promise<Uint8Array | null> {
    const entry = this.#entries.get(this.#prefix + path) ?? this.#entries.get(path)
    if (!entry) return null
    return entry.getData(new Uint8ArrayWriter())
  }

  async readText(path: string): Promise<string> {
    const bytes = await this.read(path)
    if (!bytes) throw new Error(`${path} is missing from the export`)
    return new TextDecoder().decode(bytes)
  }
}
