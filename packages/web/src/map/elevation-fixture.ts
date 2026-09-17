import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { HttpResponse, http } from 'msw'
import { TILES } from './colorful.ts'

/**
 * The one request building the vector style makes: `@versatiles/style` fetches the elevation
 * TileJSON for the hillshade's `raster-dem` source.
 *
 * The tests answer it from a committed copy, so they never reach tiles.versatiles.org — whose
 * certificate once expired in the middle of a CI run and failed both style tests on a change
 * that had nothing to do with it. The browser still fetches it live; only tests and
 * `pnpm style:app` go through here.
 *
 * `pnpm style:app` is what refreshes the copy: it fetches live once, writes it here, and builds
 * the phone's style from that same file, so the fixture and `colorful.json` change in one diff.
 */
export const ELEVATION_TILEJSON_URL = `${TILES}/tiles/elevation/tiles.json`

// Not `new URL('./…', import.meta.url)`: Vite rewrites that pattern into an asset URL, which is
// no path at all in the web test lane.
export const ELEVATION_TILEJSON_FILE = join(import.meta.dirname, 'elevation-tilejson.json')

/** Read per request, so the script can write the file and then build from it in one run. */
export const elevationTileJson = http.get(ELEVATION_TILEJSON_URL, () =>
  HttpResponse.text(readFileSync(ELEVATION_TILEJSON_FILE, 'utf8'), {
    headers: { 'content-type': 'application/json' },
  }),
)
