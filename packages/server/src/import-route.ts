import {
  type ApiError,
  type ImportFrame,
  type ImportProgress,
  importFrameSchema,
  importSelectRequestSchema,
} from '@tracks/core'
import type { Context } from 'hono'
import type { z } from 'zod'
import { type Db, openWriter, type Writer } from './db.ts'
import { ingest, selectWanted } from './ingest.ts'

/**
 * The import routes.
 *
 * Two of them, and neither knows what a Strava export or a Komoot tour is. `select`
 * answers "which of these am I missing?" so the browser fetches nothing it already has;
 * the other takes the frames and writes them.
 *
 * The write is one request from beginning to end, and that request owns the import: if
 * it goes away — the tab closed, the dialog cancelled, the page reloaded — the run is
 * abandoned and the transaction rolls back. That is why there is no job id and no route
 * to poll. There is nothing to address, because nothing outlives the connection.
 */

/** One import at a time. A module-level singleton, like the process it lives in. */
let running: string | null = null

const encoder = new TextEncoder()
const line = (progress: ImportProgress) => encoder.encode(`${JSON.stringify(progress)}\n`)

export function importRoutes(db: Db, dbPath: string) {
  return {
    /** Pure query: takes no lock, writes nothing, and is safe to ask twice. */
    async select(c: Context) {
      const body = importSelectRequestSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json(badRequest(body.error), 400)

      const { source, ids } = body.data
      return c.json({ wanted: selectWanted(db, source, ids) })
    },

    async run(c: Context) {
      const source = c.req.param('source')
      if (!source) return c.json<ApiError>({ error: 'no source named' }, 400)

      if (running !== null) {
        return c.json<ApiError>({ error: `an import from ${running} is already running` }, 409)
      }
      if (!c.req.raw.body) return c.json<ApiError>({ error: 'no frames in the body' }, 400)

      running = source

      // Aborted by whichever comes first: the client dropping the request, or the
      // response stream being cancelled because nobody is reading it any more. The
      // second is the one that fires when a small upload has already finished and the
      // tab closes part-way through the write.
      const abort = new AbortController()
      c.req.raw.signal?.addEventListener('abort', () => abort.abort(), { once: true })

      let writer: Writer
      try {
        writer = openWriter(dbPath)
      } catch (error) {
        running = null
        throw error
      }

      const body = c.req.raw.body
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          // Every write races the reader going away, and enqueueing into a cancelled
          // stream throws. Losing that race is the normal way an import is cancelled,
          // not an error, so it is swallowed here rather than caught in five places.
          const send = (progress: ImportProgress) => {
            try {
              controller.enqueue(line(progress))
            } catch {
              abort.abort()
            }
          }

          try {
            const result = await ingest(
              writer,
              frames(body, abort.signal),
              (written, title) => send({ type: 'progress', written, title }),
              abort.signal,
            )

            send({
              type: 'done',
              written: result.written,
              failed: result.failed,
              rejectedTags: [...result.rejectedTags],
            })
          } catch (error) {
            // The 200 is long gone, so the only way left to say this is in the stream.
            // The transaction is already rolled back by the time we get here.
            if (!abort.signal.aborted) {
              send({
                type: 'error',
                message: error instanceof Error ? error.message : String(error),
              })
            }
          } finally {
            writer.close()
            running = null
            try {
              controller.close()
            } catch {
              // Already cancelled by the client; there is nothing left to close.
            }
          }
        },
        cancel() {
          abort.abort()
        },
      })

      return new Response(stream, {
        headers: {
          'content-type': 'application/x-ndjson; charset=utf-8',
          // Nothing between here and the browser should hold these lines back.
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      })
    },
  }
}

/**
 * The request body, one frame at a time.
 *
 * Parsed line by line rather than buffered: the body can be tens of megabytes on a
 * first import, and the point of the browser doing the reading is that the server never
 * has to hold more than one activity at once.
 */
async function* frames(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncIterable<ImportFrame> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const text = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (text) yield parseFrame(text)
        newline = buffer.indexOf('\n')
      }
    }

    if (buffer.trim()) yield parseFrame(buffer.trim())
  } finally {
    reader.cancel().catch(() => {})
  }
}

function parseFrame(text: string): ImportFrame {
  const parsed = importFrameSchema.safeParse(JSON.parse(text))
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(`malformed frame: ${issue?.path.join('.')} ${issue?.message}`)
  }
  return parsed.data
}

function badRequest(error: z.ZodError): ApiError {
  return {
    error: 'invalid request',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  }
}
