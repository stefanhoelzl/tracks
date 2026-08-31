import {
  type ApiError,
  activitiesResponseSchema,
  activityDetailSchema,
  activityTagsResponseSchema,
  activityTagsSchema,
  type Filter,
  facetsResponseSchema,
  parseFilter,
  tagTypesResponseSchema,
  tagWriteResponseSchema,
  tagWriteSchema,
  tracksResponseSchema,
} from '@tracks/core'
import { type Context, Hono } from 'hono'
import { z } from 'zod'
import type { Db } from './db.ts'
import { importRoutes } from './import-route.ts'
import { activityDetail, facets, listActivities, listTracks, tagVocabulary } from './queries.ts'
import { loadRegistry } from './registry.ts'
import { TagWriteError, writeActivityTags, writeTags } from './tagging.ts'

/**
 * The REST surface.
 *
 * Rows, geometry and facets are three routes rather than one payload because they
 * change at different rates: the geometry is the same bytes whether you are sorting
 * the list or not, and the facets are ten small aggregates where the rows are one
 * big select. Three cache keys let each settle on its own.
 *
 * Every response is parsed against its schema on the way out. The browser parses it
 * again on the way in — the cost is nothing on a few hundred rows, and it means a
 * shape that drifts fails at the boundary that broke it rather than in a component
 * three frames later.
 *
 * The import routes are the exception to the read-only shape, and the only place the
 * database is written. They need the file's path as well as the open handle, because an
 * import runs its transaction on a second connection — see `openWriter`.
 */

function issuesOf(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
}

function badRequest(error: z.ZodError): ApiError {
  return { error: 'invalid filter', issues: issuesOf(error) }
}

/** A write's body, as opposed to its target — the two fail for different reasons. */
function badBody(error: z.ZodError): ApiError {
  return { error: 'invalid request', issues: issuesOf(error) }
}

export function createApi(db: Db, dbPath: string) {
  const app = new Hono()
  const imports = importRoutes(db, dbPath)

  /**
   * Every filtered route parses the same query string with the same function, which
   * is the whole point of the serialization living in core. A malformed URL is a 400
   * naming the field, not a query that quietly matches nothing.
   */
  const withFilter = (handler: (filter: Filter) => unknown) => (c: Context) => {
    let filter: Filter
    try {
      filter = parseFilter(new URL(c.req.url).searchParams)
    } catch (error) {
      if (error instanceof z.ZodError) return c.json(badRequest(error), 400)
      throw error
    }
    return c.json(handler(filter))
  }

  app.get(
    '/api/activities',
    withFilter((filter) =>
      activitiesResponseSchema.parse({ activities: listActivities(db, filter) }),
    ),
  )

  app.get(
    '/api/tracks',
    withFilter((filter) => tracksResponseSchema.parse(listTracks(db, filter))),
  )

  app.get(
    '/api/facets',
    withFilter((filter) => facetsResponseSchema.parse(facets(db, filter, loadRegistry(db)))),
  )

  /**
   * The bulk write, over the filter in the query string.
   *
   * Its target is parsed by `withFilter`, the same code every read uses, so what a
   * write applies to and what the sidebar was counting are the same statement. There
   * is no id list and no selection: narrowing the filter is how you say which
   * activities you mean.
   */
  app.post('/api/tags', async (c) => {
    let filter: Filter
    try {
      filter = parseFilter(new URL(c.req.url).searchParams)
    } catch (error) {
      if (error instanceof z.ZodError) return c.json(badRequest(error), 400)
      throw error
    }

    const body = tagWriteSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json(badBody(body.error), 400)

    try {
      return c.json(tagWriteResponseSchema.parse(writeTags(db, filter, body.data)))
    } catch (error) {
      if (error instanceof TagWriteError) return c.json<ApiError>({ error: error.message }, 400)
      throw error
    }
  })

  /** One activity's tags, replaced with what the detail panel is showing. */
  app.put('/api/activities/:id/tags', async (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json<ApiError>({ error: 'activity id must be a positive integer' }, 400)
    }

    const body = activityTagsSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json(badBody(body.error), 400)

    try {
      const written = writeActivityTags(db, id, body.data)
      if (!written) return c.json<ApiError>({ error: `no activity ${id}` }, 404)

      return c.json(activityTagsResponseSchema.parse(written))
    } catch (error) {
      if (error instanceof TagWriteError) return c.json<ApiError>({ error: error.message }, 400)
      throw error
    }
  })

  app.get('/api/activities/:id', (c) => {
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id) || id <= 0) {
      return c.json<ApiError>({ error: 'activity id must be a positive integer' }, 400)
    }

    const detail = activityDetail(db, id)
    if (!detail) return c.json<ApiError>({ error: `no activity ${id}` }, 404)

    return c.json(activityDetailSchema.parse(detail))
  })

  // The registry and the vocabulary in one response, because they change together:
  // every tag written can create a value, and emptying the last one deletes the type.
  // It is what the sidebar renders, what the autocomplete offers and what the colour
  // layout is laid out from.
  app.get('/api/tag-types', (c) =>
    c.json(tagTypesResponseSchema.parse(tagVocabulary(db, loadRegistry(db)))),
  )

  // The browser reads Strava and Komoot; these two write what it read. `select` says
  // what is missing so nothing is fetched twice, and the run streams its progress back
  // over a request that owns the import for as long as it is connected.
  app.post('/api/import/select', imports.select)
  app.post('/api/import/:source', imports.run)

  return app
}
