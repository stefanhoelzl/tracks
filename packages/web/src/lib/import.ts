import polyline from '@mapbox/polyline'
import {
  apiErrorSchema,
  IMPORT_PRECISION,
  type ImportFailure,
  type ImportFrame,
  importProgressSchema,
  importSelectResponseSchema,
} from '@tracks/core'
import type { ActivitySource, SourceActivity, Track } from '../sources/source.ts'
import { ApiFailure } from './api.ts'

/**
 * The import, driven from the browser in two phases.
 *
 * Phase A reads: it lists the source, asks the server which activities it is missing,
 * and pulls only those. Phase B writes: everything read goes up as one NDJSON body and
 * the server streams back what it did with it.
 *
 * Two phases rather than one continuous stream because streaming a request body needs
 * `duplex: 'half'`, which only Chromium ships. Buffering between them costs the browser
 * ~25 MB on a first import of a full account and nothing on any import after that — and
 * all-or-nothing is what the server's single transaction does anyway.
 *
 * Cancelling in phase A has sent nothing, so there is nothing to undo. Cancelling in
 * phase B aborts the request, which the server answers by rolling back.
 */

export type ImportPhase = 'listing' | 'reading' | 'writing' | 'done'

export interface ImportState {
  phase: ImportPhase
  /** How far through the current phase, against `total`. Zero while listing. */
  done: number
  total: number
  /** What is being read or written right now. */
  title: string | null
  /** Activities the browser could not read — a bad file, a tour that kept failing. */
  readFailures: ImportFailure[]
  /** Activities the server refused — a tag whose type is not in the registry. */
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

  // Phase A, step one: what does the source have? Indeterminate — Komoot's page count
  // is not known until the last page says there is no next one.
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
  state.phase = 'reading'
  state.total = missing.length
  emit()

  // Phase A, step two: pull only what is missing. Each frame is serialized as it is
  // read so the points can be dropped, rather than holding every track at once.
  const lines: string[] = []
  for (const activity of missing) {
    signal.throwIfAborted()
    state.title = activity.title
    emit()

    try {
      const track = await source.fetchTrack(activity.externalId)
      if (track && track.points.length > 0) {
        lines.push(`${JSON.stringify(toFrame(source.name, activity, track))}\n`)
      }
    } catch (error) {
      state.readFailures.push({
        externalId: activity.externalId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    state.done++
    emit()
  }

  if (lines.length === 0) {
    state.phase = 'done'
    state.title = null
    emit()
    return state
  }

  // Phase B: one request, which owns the transaction. Aborting it rolls back.
  state.phase = 'writing'
  state.done = 0
  state.total = lines.length
  state.title = null
  emit()

  const response = await fetch(`/api/import/${encodeURIComponent(source.name)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-ndjson' },
    body: new Blob(lines),
    signal,
  })

  if (!response.ok || !response.body) {
    const body = apiErrorSchema.safeParse(await response.json().catch(() => null))
    throw new ApiFailure(body.success ? body.data.error : response.statusText, response.status)
  }

  for await (const line of ndjson(response.body)) {
    const progress = importProgressSchema.parse(JSON.parse(line))

    if (progress.type === 'progress') {
      // The total is the client's: it counted the frames before it sent them, and the
      // server is reading a stream whose length it does not know.
      state.done = progress.written
      state.written = progress.written
      state.title = progress.title
    } else if (progress.type === 'done') {
      state.written = progress.written
      state.writeFailures = progress.failed
      state.rejectedTags = progress.rejectedTags
      state.phase = 'done'
      state.title = null
    } else {
      throw new Error(progress.message)
    }
    emit()
  }

  // A stream that ends without a `done` line means the connection dropped mid-write,
  // which the server treats as a cancellation — so nothing landed.
  if (state.phase !== 'done') throw new Error('the import ended before it finished')
  return state
}

/** Splits a byte stream into lines, holding one partial line at a time. */
async function* ndjson(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (line) yield line
      newline = buffer.indexOf('\n')
    }
  }

  if (buffer.trim()) yield buffer.trim()
}
