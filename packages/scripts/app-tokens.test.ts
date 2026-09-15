import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const TOKENS_CSS = fileURLToPath(new URL('../web/src/styles/tokens.css', import.meta.url))
const TOKENS_KT = fileURLToPath(
  new URL('../../app/ui/src/commonMain/kotlin/net/stho/tracks/ui/theme/Tokens.kt', import.meta.url),
)

/** `#rrggbb` or `rgba(r, g, b, a)` as Compose writes a colour: 0xAARRGGBB. */
function argb(css: string): string | null {
  const hex = css.match(/^#([0-9a-f]{6})$/i)
  if (hex) return `0xFF${hex[1]!.toUpperCase()}`
  const rgba = css.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/)
  if (!rgba) return null
  const [, r, g, b, a] = rgba
  const byte = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  return `0x${byte(Math.round(Number(a) * 255))}${[r, g, b].map((c) => byte(Number(c))).join('')}`
}

describe('the tokens the phone mirrors', () => {
  const css = new Map(
    [...readFileSync(TOKENS_CSS, 'utf8').matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(
      ([, name, value]) => [name!, value!.trim()],
    ),
  )
  const mirrored = [
    ...readFileSync(TOKENS_KT, 'utf8').matchAll(/Color\((0x[0-9A-F]{8})\)\s*\/\/\s*(--[\w-]+)/g),
  ].map(([, colour, name]) => ({ name: name!, colour: colour! }))

  it('mirrors some', () => {
    expect(mirrored.length).toBeGreaterThan(0)
  })

  for (const { name, colour } of mirrored) {
    it(`${name} is the web's`, () => {
      // A failure here is a token changed on the web and not on the phone: carry it to Tokens.kt.
      expect(argb(css.get(name) ?? '')).toBe(colour)
    })
  }
})
