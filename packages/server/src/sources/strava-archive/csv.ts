import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'

/**
 * Column positions in Strava's activities.csv.
 *
 * Read by POSITION, never by header name, for two reasons: the headers are
 * localized to the account language (German here), and several names repeat —
 * `Distanz` appears at both 6 and 17, `Verstrichene Zeit` at 5 and 15.
 *
 * Columns 15-20 are a machine-formatted block: SI units with dot decimals,
 * regardless of locale. The earlier duplicates are localized display strings
 * (`4,14` km), so the later block is the one to read.
 */
const COL = {
  activityId: 0,
  /** UTC, despite the localized formatting. */
  date: 1,
  title: 2,
  /** Localized sport name. Unused: sport comes from the track file instead. */
  sportLocalized: 3,
  /** Relative path to the track file. The ONLY link between an activity and its file. */
  filename: 12,
  elapsedS: 15,
  movingS: 16,
  distanceM: 17,
  elevationGainM: 20,
} as const

export interface ArchiveRow {
  externalId: string
  title: string | null
  /** Relative to the archive root, e.g. `activities/12670747170.gpx`. */
  filename: string
  startedAt: Date
  distanceM: number | null
  durationS: number | null
  elapsedS: number | null
  elevationGainM: number | null
}

const num = (raw: string | undefined): number | null => {
  if (!raw || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** `16.10.2024, 15:57:17` — UTC, verified against the matching GPX `Z` timestamp. */
export function parseCsvDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, d, mo, y, h, mi, s] = m
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)))
}

/**
 * Reads activities.csv, skipping rows with no track file.
 *
 * Those are pool swims — real activities with no GPS. They are not imported, which
 * keeps "zero trackpoints" meaning "not imported yet" and so preserves resumability
 * without needing a status column.
 */
export async function readArchiveCsv(csvPath: string): Promise<ArchiveRow[]> {
  const text = await readFile(csvPath, 'utf8')
  const records: string[][] = parse(text, { bom: true, relaxColumnCount: true })

  const rows: ArchiveRow[] = []
  for (const record of records.slice(1)) {
    const filename = record[COL.filename]?.trim()
    if (!filename) continue

    const externalId = record[COL.activityId]?.trim()
    if (!externalId) continue

    const startedAt = parseCsvDate(record[COL.date] ?? '')
    if (!startedAt) continue

    rows.push({
      externalId,
      title: record[COL.title]?.trim() || null,
      filename,
      startedAt,
      distanceM: num(record[COL.distanceM]),
      durationS: num(record[COL.movingS]),
      elapsedS: num(record[COL.elapsedS]),
      elevationGainM: num(record[COL.elevationGainM]),
    })
  }
  return rows
}
