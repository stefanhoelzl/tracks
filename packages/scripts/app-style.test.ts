import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { overlaysDocument } from '../web/src/map/overlays.ts'
import { generateAppStyle, OVERLAYS_FILE, STYLE_FILE } from './app-style.ts'

describe('the map style the phone draws', () => {
  it('is the style the web builds today', () => {
    // A failure here is the web's basemap changing without the phone hearing about it:
    // a new wash, a new hillshade, or a new @versatiles/style. Run `pnpm style:app`.
    expect(readFileSync(STYLE_FILE, 'utf8')).toBe(generateAppStyle())
  })

  it('draws the overlays the web draws today', () => {
    // A layer changed in overlays.ts — a width, a colour, a new state — and not carried to the
    // phone. Run `pnpm style:app`.
    expect(readFileSync(OVERLAYS_FILE, 'utf8')).toBe(overlaysDocument())
  })
})
