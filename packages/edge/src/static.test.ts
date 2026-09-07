import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import type { Assets } from './assets.ts'
import { serveAssets } from './static.ts'

const base64 = (text: string) => Buffer.from(text).toString('base64')

const ASSETS: Assets = {
  '/index.html': {
    body: base64('<!doctype html>app'),
    type: 'text/html; charset=utf-8',
    immutable: false,
  },
  '/assets/index-aKDGQXld.js': {
    body: base64('console.log(1)'),
    type: 'text/javascript; charset=utf-8',
    immutable: true,
  },
}

function app() {
  const hono = new Hono()
  hono.get('/api/session', (c) => c.json({ email: 'rider@example.com' }))
  return serveAssets(hono, ASSETS)
}

describe('serving the bundle from inside the script', () => {
  it('serves a hashed asset as immutable for a year', async () => {
    const response = await app().request('/assets/index-aKDGQXld.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await response.text()).toBe('console.log(1)')
  })

  it('never caches the shell, because it names the hashes', async () => {
    // A cached index.html outlives the deploy it belongs to and asks for files the new
    // bundle does not have.
    const response = await app().request('/index.html')

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toContain('app')
  })

  it('answers a bookmarked filter with the app rather than a 404', async () => {
    // The filter lives in the query string and the path is always the app, so a link
    // someone saved has to arrive somewhere that can read it.
    const response = await app().request('/?tag=sport:bike')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('app')
  })

  it('leaves the API alone', async () => {
    const response = await app().request('/api/session')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ email: 'rider@example.com' })
  })

  it('404s an unknown API route instead of handing back the app shell', async () => {
    // Falling through would answer a fetch with HTML, which fails as a JSON parse
    // three frames later instead of as the 404 it is.
    const response = await app().request('/api/nonsense')

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('/api/nonsense') })
  })
})
