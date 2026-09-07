import {
  type ApiError,
  activitiesResponseSchema,
  activityDetailSchema,
  activityTagsResponseSchema,
  activityTagsSchema,
  type Filter,
  facetsResponseSchema,
  parseFilter,
  sessionSchema,
  signInSchema,
  tagTypesResponseSchema,
  tagWriteResponseSchema,
  tagWriteSchema,
  tracksResponseSchema,
} from '@tracks/core'
import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { signSession, userIdIn, verifySession } from './auth.ts'
import type { Db } from './db.ts'
import { importRoutes } from './import-route.ts'
import {
  activityDetail,
  facets,
  listActivities,
  listTracks,
  scopeFor,
  tagVocabulary,
} from './queries.ts'
import type { Owner, Scope } from './query.ts'
import { loadRegistry } from './registry.ts'
import { TagWriteError, writeActivityTags, writeTags } from './tagging.ts'
import { authenticate, findCredential } from './users.ts'

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
 * database is written, one activity at a time.
 *
 * Everything under `/api` except `/api/session` is behind the cookie, and every handler
 * behind it reads its `Owner` from the context rather than being told one. That is the
 * shape multi-tenancy takes here: the boundary is crossed once, in one middleware, and
 * what comes out the other side is the only thing the data layer will accept.
 *
 * There is no server secret. A session is signed with a key derived from the signer's
 * own password hash, so establishing who is asking means reading their row first — and
 * a password that changes takes every session it signed with it.
 */

/** How long a signed cookie is good for. Rotating the secret is what ends one early. */
const SESSION_DAYS = 30
const COOKIE = 'tracks_session'

/**
 * Whether the page may be somebody else's frame.
 *
 * `SameSite=Lax` is the right answer for a site you visit: the cookie rides your own
 * navigations and no other site's requests, which is most of a CSRF defence for free.
 * It is the wrong answer for a page inside a cross-site iframe, where the browser will
 * not store it at all — which is precisely what VS Code's Simple Browser is, and why
 * `pnpm dev` sets this and a deployment does not.
 *
 * `None` requires `Secure`, and Chromium treats `http://localhost` as trustworthy, so
 * the pair works on the dev server without TLS.
 */
export interface ApiOptions {
  /** Dev only. Weakens the cookie to survive being framed; never set in production. */
  crossSite?: boolean
}

/** What the middleware puts in the context, and every handler behind it reads. */
export interface Env {
  Variables: { owner: Owner }
}

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

export function createApi(db: Db, options: ApiOptions = {}) {
  const app = new Hono<Env>()
  const imports = importRoutes(db)

  /**
   * Sign in, and claim the account if it has never been signed into.
   *
   * One message for every failure — a wrong password, an unknown address, a malformed
   * body — because saying which is telling a stranger who has an account here.
   */
  /**
   * The attributes that decide whether a cookie is stored at all.
   *
   * Shared by the one that signs in and the one that signs out, because a browser
   * matches them on the way out too: a `Set-Cookie` that clears the session is
   * rejected in a framed page unless it carries the same `None; Secure` pair the
   * original did — and the cookie then outlives the sign-out that meant to end it.
   */
  const attributes = (c: Context) =>
    ({
      path: '/',
      sameSite: options.crossSite ? ('None' as const) : ('Lax' as const),
      // Secure is mandatory alongside None, and otherwise follows the scheme: a Secure
      // cookie on the plain-http dev server would never come back.
      secure: options.crossSite || new URL(c.req.url).protocol === 'https:',
    }) satisfies Parameters<typeof setCookie>[3]

  app.post('/api/session', async (c) => {
    const body = signInSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json<ApiError>({ error: 'wrong email or password' }, 401)

    const account = await authenticate(db, body.data.email, body.data.password)
    if (!account) return c.json<ApiError>({ error: 'wrong email or password' }, 401)

    const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    setCookie(c, COOKIE, await signSession(account.passwordHash, account.id, expiresAt), {
      ...attributes(c),
      httpOnly: true,
      expires: new Date(expiresAt),
    })

    return c.json(sessionSchema.parse({ email: account.email }))
  })

  app.delete('/api/session', (c) => {
    deleteCookie(c, COOKIE, attributes(c))
    return c.body(null, 204)
  })

  /**
   * Who am I? — the question the browser asks before it draws anything.
   *
   * Its 401 is not a failure to report but the answer that puts the sign-in page up,
   * which is why it is the one authenticated route that is not behind the middleware.
   */
  app.get('/api/session', async (c) => {
    const account = await accountOf(c)
    if (!account) return c.json<ApiError>({ error: 'not signed in' }, 401)

    return c.json(sessionSchema.parse({ email: account.email }))
  })

  /**
   * The cookie's signer, or null.
   *
   * Two steps, in this order and no other: the token says which user it claims to be,
   * that user's row supplies the key, and only then is the signature checked. The id
   * is read from an unverified string on purpose — it addresses a row, it does not
   * grant anything, and nothing is trusted until the HMAC agrees.
   */
  const accountOf = async (c: Context) => {
    const token = getCookie(c, COOKIE)
    if (!token) return null

    const claimed = userIdIn(token)
    if (claimed === null) return null

    const account = findCredential(db, claimed)
    if (!account) return null

    const userId = await verifySession(account.passwordHash, token)
    return userId === account.id ? account : null
  }

  /**
   * The one place the boundary is crossed.
   *
   * One read and one signature. The read is unavoidable once the key is the signer's
   * own password hash, and it is what a password change rides on: the row it returns
   * no longer produces the key the cookie was made with.
   */
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/session') return next()

    const account = await accountOf(c)
    if (!account) return c.json<ApiError>({ error: 'not signed in' }, 401)

    c.set('owner', { userId: account.id })
    await next()
  })

  /**
   * Every filtered route parses the same query string with the same function, which
   * is the whole point of the serialization living in core. A malformed URL is a 400
   * naming the field, not a query that quietly matches nothing.
   */
  const withFilter = (handler: (scope: Scope) => unknown) => (c: Context<Env>) => {
    let filter: Filter
    try {
      filter = parseFilter(new URL(c.req.url).searchParams)
    } catch (error) {
      if (error instanceof z.ZodError) return c.json(badRequest(error), 400)
      throw error
    }
    return c.json(handler(scopeFor(db, c.get('owner'), filter)))
  }

  app.get(
    '/api/activities',
    withFilter((scope) =>
      activitiesResponseSchema.parse({ activities: listActivities(db, scope) }),
    ),
  )

  app.get(
    '/api/tracks',
    withFilter((scope) => tracksResponseSchema.parse(listTracks(db, scope))),
  )

  app.get(
    '/api/facets',
    withFilter((scope) => facetsResponseSchema.parse(facets(db, scope, loadRegistry(db, scope)))),
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
      return c.json(
        tagWriteResponseSchema.parse(
          writeTags(db, scopeFor(db, c.get('owner'), filter), body.data),
        ),
      )
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
      const written = writeActivityTags(db, c.get('owner'), id, body.data)
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

    const detail = activityDetail(db, c.get('owner'), id)
    if (!detail) return c.json<ApiError>({ error: `no activity ${id}` }, 404)

    return c.json(activityDetailSchema.parse(detail))
  })

  // The registry and the vocabulary in one response, because they change together:
  // every tag written can create a value, and emptying the last one deletes the type.
  // It is what the sidebar renders, what the autocomplete offers and what the colour
  // layout is laid out from.
  app.get('/api/tag-types', (c) => {
    const owner = c.get('owner')
    return c.json(tagTypesResponseSchema.parse(tagVocabulary(db, owner, loadRegistry(db, owner))))
  })

  // The browser reads Strava and Komoot; these two write what it read. `select` says
  // what is missing so nothing is fetched twice, and the other takes one activity —
  // the frame names its own source, so the route does not repeat it and the two can
  // never disagree.
  app.post('/api/import/select', imports.select)
  app.post('/api/import', imports.run)

  return app
}
