import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { generateAppIcons } from './app-icon.ts'

const at = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

describe('the icons the phone and the web ship', () => {
  it.each([...generateAppIcons()])('%s is drawn from the mark today', (path, body) => {
    // A failure here is the mark, or the accent in tokens.css, changing without the icons
    // following. Run `pnpm icon:app`.
    expect(readFileSync(at(path)).equals(body)).toBe(true)
  })
})
