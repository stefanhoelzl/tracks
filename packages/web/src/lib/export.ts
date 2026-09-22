import type { Filter } from '@tracks/core'
import { fetchActivities, fetchActivityDetail } from './api.ts'
import { GPX_HEAD, GPX_TAIL, gpxTrack } from './gpx-writer.ts'

/**
 * Everything the filter matches, as one GPX.
 *
 * Built here rather than on the server, for the reason imports are read here: the edge
 * has 128 MB a request, and a whole account is a million points. The tab fetches each
 * activity's detail — the route the detail panel already reads — and turns it into its
 * `<trk>` as it lands, so what is held is text and never the decoded arrays of more
 * than a few activities.
 *
 * "What the filter matches" is the list, the viewport included: the export is the rows
 * you are looking at, in their order. With an activity open that is one activity.
 *
 * All or nothing. A failed fetch stops the rest and saves no file, because a file that
 * looks complete and is missing a ride is worse than no file. An activity with no track
 * is not a failure; it has nothing to write, and is left out.
 */

/** Enough to overlap the round trips, few enough not to crowd out the map's own requests. */
const CONCURRENCY = 4

export interface ExportProgress {
  done: number
  total: number
}

export async function exportGpx(
  filter: Filter,
  { signal, onProgress }: { signal: AbortSignal; onProgress: (progress: ExportProgress) => void },
): Promise<Blob> {
  const { activities } = await fetchActivities(filter, signal)
  const total = activities.length
  const tracks: Array<string | null> = new Array(total).fill(null)

  // One failure stops the other workers too, rather than letting them fetch on for a
  // file that will never be saved.
  const stop = new AbortController()
  const either = AbortSignal.any([signal, stop.signal])

  let next = 0
  let done = 0
  onProgress({ done, total })

  const worker = async () => {
    while (next < total) {
      const index = next++
      const activity = activities[index]
      if (!activity) continue
      tracks[index] = gpxTrack(await fetchActivityDetail(activity.id, either))
      onProgress({ done: ++done, total })
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker))
  } catch (error) {
    stop.abort()
    throw error
  }

  return new Blob([GPX_HEAD, ...tracks.filter((track) => track !== null), GPX_TAIL], {
    type: 'application/gpx+xml',
  })
}

/** `tracks-2026-09-22.gpx`, dated by the clock of whoever saved it. */
export function exportFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `tracks-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.gpx`
}

/** Hands the file to the browser's own download, as a link click would. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Revoked on the next turn rather than at once: some browsers start reading the URL
  // only after the click handler has returned.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
