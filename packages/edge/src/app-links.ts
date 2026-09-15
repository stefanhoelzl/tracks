import type { Env, Hono } from 'hono'

/**
 * The file that lets iOS open tracks.stho.net plan links in the app.
 *
 * The one thing the iPhone app adds to the server. It names the app and the links that
 * are its own — the web's planning mode, `/?mode=planning`, whose plan is in the
 * fragment — and nothing else: an activity link, a filter, the sign-in page all stay the
 * web's, and the fragment itself still never reaches the server, because a fragment is
 * never sent.
 *
 * A route of its own rather than a file in the bundle: the asset table types by
 * extension, and this path has none, where iOS wants JSON. Registered before the app
 * shell's catch-all, which would otherwise answer it with `index.html`.
 */

/** The team the app is signed by, and its bundle id. */
export const APP_ID = 'E9Z8BADH58.net.stho.tracks'

export const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    details: [
      {
        appIDs: [APP_ID],
        components: [
          {
            '/': '/',
            '?': { mode: 'planning' },
            comment: 'A plan: the planning mode, with the plan in the fragment',
          },
        ],
      },
    ],
  },
}

export function serveAppLinks<E extends Env>(app: Hono<E>): Hono<E> {
  // Apple's CDN fetches it and keeps it for its own reasons; an hour here only bounds how
  // long a change takes to reach a phone that asks directly.
  app.get('/.well-known/apple-app-site-association', (c) =>
    c.json(APPLE_APP_SITE_ASSOCIATION, 200, { 'cache-control': 'public, max-age=3600' }),
  )
  return app
}
