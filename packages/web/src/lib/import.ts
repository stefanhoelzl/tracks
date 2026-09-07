import polyline from '@mapbox/polyline'
import {
  apiErrorSchema,
  IMPORT_PRECISION,
  type ImportFailure,
  type ImportFrame,
  importActivityResponseSchema,
  importSelectResponseSchema,
} from '@tracks/core'
import type { ActivitySource, SourceActivity, Track } from '../sources/source.ts'
import { ApiFailure } from './api.ts'

/**
 * The import, driven from the browser.
 *
 * It lists the source, asks the server which activities are missing, and then reads and
 * sends them one at a time. The read and the write used to be separate phases: a request
 * body cannot be streamed without `duplex: 'half'`, which only Chromium ships, so every
 * frame was buffered — ~25 MB on a first import of a full account — and posted as one
 * NDJSON body that the server wrote inside one transaction.
 *
 * One request per activity removes the reason for both. Nothing is buffered, because a
 * track is sent the moment it is read and dropped the moment it is sent; and there is no
 * second phase to be in, so the bar counts activities rather than phases.
 *
 * Cancelling stops the loop. What has already been written stays, which is the honest
 * thing to say about it — and costs nothing, because `select` reports what is missing at
 * the start of every run, so the next attempt continues where this one stopped.
 */

export type ImportPhase = 'listing' | 'importing' | 'done'

export interface ImportState {
  phase: ImportPhase
  /** How far through the current phase, against `total`. Zero while listing. */
  done: number
  total: number
  /** What is being read or written right now. */
  title: string | null
  /** Activities the browser could not read — a bad file, a tour that kept failing. */
  readFailures: ImportFailure[]
  /** Activities the server refused — an unreadable geometry, a date it cannot parse. */
  writeFailures: ImportFailure[]
  written: number
  /** Enum values a source derived that the registry had lost, and got back. */
  /** Derived tags no registry type could accept, counted by tag. */
  rejectedTags: Array<[string, number]>
}

const initial = (): ImportState => ({
  phase: 'listing',
  done: 0,
  total: 0,
  title: null,
  readFailures: [],
  writeFailures: [],
  written: 0,
  rejectedTags: [],
})

/**
 * One activity, ready for the wire.
 *
 * `source:` is deliberately not added here. The server derives it from the frame's own
 * `source` field, so a client cannot send a column and a tag that disagree.
 */
export function toFrame(source: string, activity: SourceActivity, track: Track): ImportFrame {
  const startEpoch = Math.round(activity.startedAt.getTime() / 1000)
  const hasAltitude = track.points.some((p) => p.altitudeM !== null)
  const hasTime = track.points.some((p) => p.recordedAt !== null)

  return {
    source,
    externalId: activity.externalId,
    // The track's own name beats the service title: "Almenrunde" over Strava's
    // auto-generated "Fahrt am Morgen".
    title: track.title ?? activity.title,
    startedAt: activity.startedAt.toISOString(),
    distanceM: activity.distanceM,
    durationS: activity.durationS,
    elapsedS: activity.elapsedS,
    elevationGainM: activity.elevationGainM,
    tags: track.tags,
    geometry: polyline.encode(
      track.points.map((p) => [p.lat, p.lon] as [number, number]),
      IMPORT_PRECISION,
    ),
    altitudes: hasAltitude ? track.points.map((p) => p.altitudeM) : null,
    times: hasTime
      ? track.points.map((p) => (p.recordedAt === null ? null : p.recordedAt - startEpoch))
      : null,
  }
}

async function readJson<T>(response: Response, schema: { parse: (v: unknown) => T }): Promise<T> {
  if (!response.ok) {
    const body = apiErrorSchema.safeParse(await response.json().catch(() => null))
    throw new ApiFailure(body.success ? body.data.error : response.statusText, response.status)
  }
  return schema.parse(await response.json())
}

/** Which of these does the server not already have a track for? */
async function select(source: string, ids: string[], signal: AbortSignal): Promise<Set<string>> {
  const response = await fetch('/api/import/select', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source, ids }),
    signal,
  })
  return new Set((await readJson(response, importSelectResponseSchema)).wanted)
}

export async function runImport(
  source: ActivitySource,
  onState: (state: ImportState) => void,
  signal: AbortSignal,
): Promise<ImportState> {
  const state = initial()
  const emit = () => onState({ ...state })

  // Step one: what does the source have? Indeterminate — Komoot's page count is not
  // known until the last page says there is no next one.
  emit()
  const listed: SourceActivity[] = []
  for await (const activity of source.listActivities()) {
    signal.throwIfAborted()
    listed.push(activity)
  }

  const wanted = await select(
    source.name,
    listed.map((a) => a.externalId),
    signal,
  )

  const missing = listed.filter((a) => wanted.has(a.externalId))
  state.phase = 'importing'
  state.total = missing.length
  emit()

  const rejected = new Map<string, number>()

  for (const activity of missing) {
    signal.throwIfAborted()
    state.title = activity.title
    emit()

    try {
      const track = await source.fetchTrack(activity.externalId)
      if (track && track.points.length > 0) {
        // Read and sent in the same breath, so the points are collectable immediately
        // afterwards rather than held until every other track has been read too.
        const written = await send(toFrame(source.name, activity, track), signal)
        for (const [tag, count] of written.rejectedTags) {
          rejected.set(tag, (rejected.get(tag) ?? 0) + count)
        }
        state.written++
      }
    } catch (error) {
      if (signal.aborted) throw error

      const failure = {
        externalId: activity.externalId,
        error: error instanceof Error ? error.message : String(error),
      }
      // Which half failed is worth keeping apart: one is a source that would not give
      // up a track, the other is this activity being refused after it arrived.
      if (error instanceof ApiFailure) state.writeFailures.push(failure)
      else state.readFailures.push(failure)
    }

    state.done++
    emit()
  }

  state.rejectedTags = [...rejected]
  state.phase = 'done'
  state.title = null
  emit()
  return state
}

/** One activity, written or refused. A refusal costs that activity and nothing else. */
async function send(frame: ImportFrame, signal: AbortSignal) {
  const response = await fetch('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(frame),
    signal,
  })
  return readJson(response, importActivityResponseSchema)
}
