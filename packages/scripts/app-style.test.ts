import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generateAppStyle, STYLE_FILE } from './app-style.ts'

describe('the map style the phone draws', () => {
  it('is the style the web builds today', () => {
    // A failure here is the web's basemap changing without the phone hearing about it:
    // a new wash, a new hillshade, or a new @versatiles/style. Run `pnpm style:app`.
    expect(readFileSync(STYLE_FILE, 'utf8')).toBe(generateAppStyle())
  })
})
