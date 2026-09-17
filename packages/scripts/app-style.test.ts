import { readFileSync } from 'node:fs'
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { elevationTileJson } from '../web/src/map/elevation-fixture.ts'
import { generateAppStyle, STYLE_FILE } from './app-style.ts'

// The elevation TileJSON comes from the committed fixture: this suite stays offline.
const server = setupServer(elevationTileJson)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())

describe('the map style the phone draws', () => {
  it('is the style the web builds today', async () => {
    // A failure here is the web's basemap changing without the phone hearing about it:
    // a new wash, a new hillshade, or a new @versatiles/style. Run `pnpm style:app`.
    expect(readFileSync(STYLE_FILE, 'utf8')).toBe(await generateAppStyle())
  })
})
