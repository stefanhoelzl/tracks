import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { APP_ID, type APPLE_APP_SITE_ASSOCIATION, serveAppLinks } from './app-links.ts'
import type { Assets } from './assets.ts'
import { serveAssets } from './static.ts'

const ASSETS: Assets = {
  '/index.html': {
    body: Buffer.from('<!doctype html>app').toString('base64'),
    type: 'text/html; charset=utf-8',
    immutable: false,
  },
}

/** Wired as main.ts wires it: the app links first, the shell's catch-all after. */
const app = () => serveAssets(serveAppLinks(new Hono()), ASSETS)

type Association = typeof APPLE_APP_SITE_ASSOCIATION

describe('the apple-app-site-association file', () => {
  it('is JSON at its well-known path, not the app shell', async () => {
    const response = await app().request('/.well-known/apple-app-site-association')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toMatch(/^application\/json/)
    const body = (await response.json()) as Association
    expect(body.applinks.details[0]?.appIDs).toEqual([APP_ID])
  })

  it('claims only planning links, which are the ones carrying a plan', async () => {
    const response = await app().request('/.well-known/apple-app-site-association')
    const body = (await response.json()) as Association
    const component = body.applinks.details[0]?.components[0]

    expect(component?.['/']).toBe('/')
    expect(component?.['?']).toEqual({ mode: 'planning' })
  })

  it('leaves every other path to the app', async () => {
    const response = await app().request('/?mode=planning')

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('app')
  })
})
