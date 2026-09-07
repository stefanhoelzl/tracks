import type { Context, Env, Hono } from 'hono'
import type { Assets } from './assets.ts'

/**
 * Serving the browser bundle from inside the script.
 *
 * Two cache headers and one fallback, which is the whole of what a single-page app
 * needs. A hashed filename is immutable and may be kept for a year; `index.html` names
 * those hashes and so must never be cached at all, or a deploy leaves browsers asking
 * for files the new bundle does not have.
 *
 * Anything that is not an asset and not `/api` is `index.html`, because the app puts
 * its filter in the URL and a bookmarked one has to arrive somewhere.
 */
const YEAR = 60 * 60 * 24 * 365

function bytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function serveAssets<E extends Env>(app: Hono<E>, assets: Assets): Hono<E> {
  const send = (c: Context<E>, path: string) => {
    const asset = assets[path]
    if (!asset) return null

    return c.body(bytes(asset.body) as unknown as ArrayBuffer, 200, {
      'content-type': asset.type,
      'cache-control': asset.immutable ? `public, max-age=${YEAR}, immutable` : 'no-store',
    })
  }

  app.get('*', (c) => {
    const { pathname } = new URL(c.req.url)

    // `/api` never falls through to the app shell: an unknown route there is a 404,
    // not an HTML page that a fetch would then fail to parse as JSON.
    if (pathname.startsWith('/api/')) return c.json({ error: `no route ${pathname}` }, 404)

    return send(c, pathname) ?? send(c, '/index.html') ?? c.text('not built', 500)
  })

  return app
}
