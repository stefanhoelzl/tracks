import {
  type ApiError,
  importActivityResponseSchema,
  importFrameSchema,
  importSelectRequestSchema,
} from '@tracks/core'
import type { Context } from 'hono'
import type { z } from 'zod'
import type { Env } from './api.ts'
import type { Db } from './db.ts'
import { ingestActivity, selectWanted } from './ingest.ts'

/**
 * The import routes.
 *
 * Two of them, and neither knows what a Strava export or a Komoot tour is. `select`
 * answers "which of these am I missing?" so the browser fetches nothing it already has;
 * the other takes one activity and writes it.
 *
 * One activity per request, because the alternative does not survive an isolate. The
 * old shape was a single streaming request that owned the whole import: it held one
 * transaction from the first activity to the last on a second connection, streamed
 * NDJSON progress back, and rolled back if the connection went away. All of that
 * assumed one long-lived process — and a module-level variable was enough to enforce
 * one import at a time, which is only true while there is one module.
 *
 * So the loop moves to the tab, which was already driving the reading half. Progress is
 * the response to each request rather than a line in a stream, cancelling is the browser
 * stopping, and what has landed stays. There is no job to address and still nothing to
 * poll — not because nothing outlives the connection, but because nothing outlives the
 * request either.
 *
 * Both are addressed to whoever is signed in: what is already imported is asked of their
 * activities, and what arrives is written as theirs.
 */

export function importRoutes(db: Db) {
  return {
    /** Pure query: takes no lock, writes nothing, and is safe to ask twice. */
    async select(c: Context<Env>) {
      const body = importSelectRequestSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json(badRequest(body.error), 400)

      const { source, ids } = body.data
      return c.json({ wanted: await selectWanted(db, c.get('owner'), source, ids) })
    },

    /**
     * One activity, written or refused.
     *
     * A 400 is this activity's failure and not the run's: the browser records it, moves
     * to the next one, and a later attempt picks it up again because `select` will still
     * report it as missing. One unreadable GPX costs itself, which is what the old
     * rollback was careful to preserve too.
     */
    async run(c: Context<Env>) {
      const body = importFrameSchema.safeParse(await c.req.json().catch(() => null))
      if (!body.success) return c.json(badRequest(body.error), 400)

      try {
        const result = await ingestActivity(db, c.get('owner'), body.data)
        return c.json(
          importActivityResponseSchema.parse({ rejectedTags: [...result.rejectedTags] }),
        )
      } catch (error) {
        return c.json<ApiError>(
          { error: error instanceof Error ? error.message : String(error) },
          400,
        )
      }
    },
  }
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
