/**
 * The map style the phone draws, written from the one the web draws.
 *
 *     pnpm style:app
 *
 * `@versatiles/style` builds `colorful` in JavaScript — the wash is a recolour of every layer's
 * paint, not something MapLibre Native can do at runtime. So the style is built here, once, by the
 * same `washedColorful()` the web calls, and committed into the app as JSON. Tiles, glyphs and
 * sprites stay remote URLs in it; only the style document travels.
 *
 * Building it fetches the elevation TileJSON. The script fetches that live once, writes it as the
 * tests' fixture, and builds from the fixture — so the two are refreshed together and cannot
 * drift. `app-style.test.ts` regenerates the style in memory from the fixture and compares with
 * what is committed, so a change to the web's style that is not carried to the phone fails the
 * TypeScript suite, offline.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setupServer } from 'msw/node'
import { washedColorful } from '../web/src/map/colorful.ts'
import {
  ELEVATION_TILEJSON_FILE,
  ELEVATION_TILEJSON_URL,
  elevationTileJson,
} from '../web/src/map/elevation-fixture.ts'

export const STYLE_FILE = fileURLToPath(
  new URL('../../app/ui/src/commonMain/composeResources/files/colorful.json', import.meta.url),
)

/** The style as committed, built against whatever answers the elevation TileJSON request. */
export async function generateAppStyle(): Promise<string> {
  return `${JSON.stringify(await washedColorful(), null, 1)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const response = await fetch(ELEVATION_TILEJSON_URL)
  if (!response.ok) throw new Error(`${ELEVATION_TILEJSON_URL}: ${response.status}`)
  writeFileSync(ELEVATION_TILEJSON_FILE, JSON.stringify(await response.json()))
  // Biome checks JSON under packages/web; formatted here, a refresh never fails `pnpm check`.
  execFileSync('pnpm', ['exec', 'biome', 'format', '--write', ELEVATION_TILEJSON_FILE], {
    stdio: 'ignore',
  })
  console.log(`wrote ${ELEVATION_TILEJSON_FILE}`)

  const server = setupServer(elevationTileJson)
  server.listen({ onUnhandledRequest: 'error' })
  try {
    mkdirSync(dirname(STYLE_FILE), { recursive: true })
    writeFileSync(STYLE_FILE, await generateAppStyle())
  } finally {
    server.close()
  }
  console.log(`wrote ${STYLE_FILE}`)
}
