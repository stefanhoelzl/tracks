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
 * `app-style.test.ts` regenerates it in memory and compares with what is committed, so a change
 * to the web's style that is not carried to the phone fails the TypeScript suite.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { washedColorful } from '../web/src/map/colorful.ts'

export const STYLE_FILE = fileURLToPath(
  new URL('../../app/ui/src/commonMain/composeResources/files/colorful.json', import.meta.url),
)

export async function generateAppStyle(): Promise<string> {
  return `${JSON.stringify(await washedColorful(), null, 1)}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(STYLE_FILE), { recursive: true })
  writeFileSync(STYLE_FILE, await generateAppStyle())
  console.log(`wrote ${STYLE_FILE}`)
}
