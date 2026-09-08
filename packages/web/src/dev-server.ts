import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createApi } from '../../server/src/api.ts'
import { openDb } from '../../server/src/db.ts'
import { users } from '../../server/src/schema.ts'

/**
 * The dev entry point: the same API the CLI serves, opened against the same file.
 *
 * Deliberately not the whole of `tracks serve` — Vite is serving the browser bundle
 * here, so mounting a `dist` that does not exist yet would be the one difference
 * that makes development lie about production.
 */
/**
 * A URL rather than a path, because the client behind it takes both: `file:` opens the
 * embedded libSQL in this process, and an `https:` URL is Bunny Database.
 *
 * Required, with no fallback. It used to default to `data/tracks.db`, which was right
 * while that file was the truth and became a trap the moment it was not: with the file
 * deleted, `openDb` would create and migrate an empty one, and development would come
 * up working and empty rather than pointing at the database that has the activities in
 * it. Saying which database you mean is one line in a shell; guessing wrong is an
 * afternoon of wondering where 203 activities went.
 */
/**
 * Three ways to develop, one variable that picks between them.
 *
 *   pnpm dev         the deployed database, through proton-env
 *   pnpm dev:local   `data/dev.db`, filled by `pnpm db:seed` or `pnpm db:pull`
 *
 * `pnpm dev` wraps itself in `proton-env`, which reads `.proton.yaml` — a map from
 * variable names to items in a password manager — and injects them for the child
 * process. So the credential is never in the repository, never in a dotfile, and never
 * in shell history; what is in the repository is the *name* of where to find it, and
 * that is gitignored too because naming somebody's vault items is still telling.
 *
 * `.env` remains as the fallback for a machine without proton-env, read here rather
 * than by Vite, which loads env files for the browser bundle and not for the process
 * this runs in.
 *
 * The variable picks one more thing than which database. A `file:` URL is also signed
 * into automatically, so `pnpm dev:local` opens on the map rather than on the form;
 * `pnpm dev` is left at the door, because the data behind it is real. See `signIn`.
 */
const env = resolve(import.meta.dirname, '../../../.env')
if (existsSync(env)) process.loadEnvFile(env)

/**
 * A relative `file:` URL means relative to the repository, not to whatever directory
 * the dev server happens to start in — which is `packages/web`, because `pnpm dev`
 * filters into it. Left alone, `file:data/dev.db` quietly creates a second, empty
 * database one directory down, and the app comes up signed in with nothing on the map.
 */
const root = resolve(import.meta.dirname, '../../..')
const raw = process.env.TRACKS_DB_URL
const url =
  raw?.startsWith('file:') && !raw.startsWith('file:/')
    ? `file:${resolve(root, raw.slice('file:'.length))}`
    : raw

if (!url) {
  throw new Error(
    'TRACKS_DB_URL is not set.\n' +
      '  pnpm dev:local    against data/dev.db — fill it with `pnpm db:seed` or `pnpm db:pull`\n' +
      '  pnpm dev          against the deployed database, through proton-env\n' +
      '                    (or TRACKS_DB_URL and TRACKS_DB_TOKEN in a gitignored .env)',
  )
}

const { db } = await openDb(url, resolve(root, 'migrations'), process.env.TRACKS_DB_TOKEN)

/**
 * `crossSite` because the app is looked at through VS Code's Simple Browser, which
 * renders it in a `vscode-webview://` iframe. A `SameSite=Lax` cookie is not stored in
 * a cross-site frame at all, so signing in there succeeds and the very next request
 * arrives anonymous.
 *
 * This is the one thing the dev server does differently from a deployment, and it is
 * written down rather than inferred: production is `Lax`, and nothing sets this but
 * this file.
 */
const api = createApi(db, { crossSite: true })

/**
 * Development does not start at the sign-in form.
 *
 * The form is a door for the deployed app to have; on `pnpm dev:local` it is a password
 * you type into a database you generated ten seconds ago, every time the server
 * restarts, which is several times an hour. So the dev server signs itself in and hands
 * the browser the cookie.
 *
 * Everything that follows lives in this file and only in this file — no flag on
 * `createApi`, nothing in `api.ts`. That is the whole point rather than tidiness. The
 * deployable is one esbuild pass from `packages/edge/src/main.ts`, and this module is
 * reachable only from `vite.config.ts`, so none of it is in `dist/script.js` to be
 * enabled by accident. An option on `createApi` would ship the branch to production and
 * guard it by convention, which is the guarantee `crossSite` has: a comment.
 *
 * The second guard is the database. Only a `file:` URL is signed into, so `pnpm dev`
 * against the deployed database still shows the form — deliberate friction in front of
 * real data, and a condition production could not satisfy if the code were there at all.
 */
const DEV_PASSWORD = 'password'

/**
 * The `Set-Cookie` a real sign-in produces, or null if there is not going to be one.
 *
 * It signs in *through the API* rather than reaching for `signSession`, and the
 * difference is worth the round trip. `POST /api/session` runs `authenticate`, which is
 * already the path that claims a passwordless account on its first sign-in — so nothing
 * here has to know how to claim one, or write to `users` at all. What comes back is the
 * header `api.ts` wrote, kept whole, so the attributes that decide whether a browser
 * stores it cannot drift from the ones it would have got by typing the password.
 */
async function signIn(): Promise<string | null> {
  // The lowest id, which is the account migration 0004 seeds and the one `db:seed` and
  // `db:pull` put everything on. No accounts at all means the file is not a Tracks
  // database yet, and that is worth stopping for rather than serving a form nobody can
  // get through.
  const user = await db.select({ email: users.email }).from(users).orderBy(users.id).limit(1).get()
  if (!user) {
    throw new Error(`no accounts in ${url} — run \`pnpm db:seed\` to make one`)
  }

  const response = await api.fetch(
    new Request('http://localhost/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: DEV_PASSWORD }),
    }),
  )

  // A 401 means somebody has already signed into this database with a password of their
  // own, and this one is not it. Their database, their password — say so and serve the
  // form, rather than refusing to start over a convenience.
  if (!response.ok) {
    console.warn(
      `\n  auto sign-in failed: ${user.email} already has a password, and it is not the dev one.\n` +
        '  Sign in with it, or run `pnpm db:seed` for a fresh database.\n',
    )
    return null
  }

  console.log(`\n  signed in as ${user.email} — password: ${DEV_PASSWORD}\n`)
  return response.headers.getSetCookie()[0] ?? null
}

const session = url.startsWith('file:') ? await signIn() : null

/**
 * The cookie the sign-in produced, as a request header would carry it.
 *
 * A request already holding exactly this is left alone; anything else — no cookie, or
 * one left in a browser by an earlier database — is overwritten. Overwriting rather
 * than respecting what is there is what survives `pnpm db:seed`, which rebuilds the
 * account with a new salt and so makes every cookie already in a browser unverifiable.
 */
const pair = session?.split(';', 1)[0] ?? ''

/**
 * Signing out is what stops the injection, and nothing else does.
 *
 * The obvious latch — inject into the first request and never again — cannot work, and
 * failed in a way worth writing down. The browser does not make one request; it makes
 * `session`, `tag-types`, `activities`, `tracks` and `facets` at once, all sent before
 * any reply arrives. Injecting into whichever landed first left its siblings carrying
 * whatever stale cookie the browser had, and `main.tsx` turns any 401 into
 * `setQueryData(SESSION_KEY, null)` — so one unlucky sibling puts the sign-in page up
 * over an app that had authenticated perfectly well. Being a race, it did this
 * intermittently, which is the worst way to be wrong.
 *
 * Latching on the sign-out instead is both narrower and more honest: it names the event
 * that should end the session rather than a request count standing in for it. Every
 * request without the cookie is served until somebody actually signs out; after that,
 * none is, and the form is reachable. Restarting the dev server signs in again.
 */
let signedOut = false

const isSignOut = (request: Request) =>
  request.method === 'DELETE' && new URL(request.url).pathname === '/api/session'

/**
 * The cookie goes on the request *and* on the response.
 *
 * On the request so this one is authenticated; on the response so the browser keeps it
 * and stops needing this file. Injecting inbound alone would sign in exactly one
 * request and 401 everything after it.
 */
const fetch: typeof api.fetch = async (request, env, executionCtx) => {
  if (!session || signedOut || request.headers.get('cookie')?.includes(pair)) {
    const response = await api.fetch(request, env, executionCtx)
    // Read from the request that did it rather than tracked as state elsewhere: the
    // sign-out is the only thing that has to be noticed here, and it is noticed once.
    if (response.ok && isSignOut(request)) signedOut = true
    return response
  }

  const headers = new Headers(request.headers)
  headers.set('cookie', pair)

  /**
   * Rebuilt from its parts, not `new Request(request, { headers })`.
   *
   * The object Vite hands over is `@hono/node-server`'s own Request, and undici's copy
   * constructor reads private state off its argument — so it rejects anything that is
   * not one of its own, with a message about a private member that says nothing about
   * what is wrong. `duplex` is required whenever a body is passed and ignored otherwise.
   */
  const signed = new Request(request.url, {
    method: request.method,
    headers,
    body: request.body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' })

  const response = await api.fetch(signed, env, executionCtx)

  // Rebuilt rather than mutated: a Response's headers are guarded once it exists, and
  // this is the only way to add one.
  const framed = new Response(response.body, response)
  framed.headers.append('set-cookie', session)
  return framed
}

export default { fetch }
