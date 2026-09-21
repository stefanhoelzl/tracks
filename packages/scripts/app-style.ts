/**
 * The map style the phone draws, written from the one the web draws.
 *
 *     pnpm style:app
 *
 * `@versatiles/style` builds the style in JavaScript — the wash is a recolour of every layer's
 * paint, not something MapLibre Native can do at runtime. So the style is built here, once, by the
 * same `washedColorful()` the web calls, and committed into the app as JSON. Tiles, glyphs and
 * sprites stay remote URLs in it; only the style document travels.
 *
 * Building it asks nothing of the network, so `app-style.test.ts` regenerates it in memory and
 * compares with what is committed: a change to the web's style that is not carried to the phone
 * fails the TypeScript suite, offline.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { washedColorful } from '../web/src/map/colorful.ts'

export const STYLE_FILE = fileURLToPath(
  new URL('../../app/ui/src/commonMain/composeResources/files/colorful.json', import.meta.url),
)

/** The style as committed. */
export function generateAppStyle(): string {
  return `${JSON.stringify(washedColorful(), null, 1)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(STYLE_FILE), { recursive: true })
  writeFileSync(STYLE_FILE, generateAppStyle())
  console.log(`wrote ${STYLE_FILE}`)
}
