/**
 * Every icon file Tracks ships, drawn from the one mark in `packages/web/src/lib/mark.ts`.
 *
 *     pnpm icon:app
 *
 * The phone gets an asset catalog with a 1024px icon in each of iOS's three looks: the white map on
 * the accent green, the map in a brighter green over whatever dark gradient iOS paints behind a
 * transparent icon, and a grey map iOS colours with the tint the rider picked. The web gets a
 * favicon, the touch icon Safari puts on a home screen, and a manifest with the sizes Chrome asks
 * for — among them a maskable one, whose map keeps inside the circle Android may crop it to.
 *
 * The greens are read from `tokens.css`, so an accent changed there reaches the icons through this.
 * `app-icon.test.ts` regenerates everything in memory and compares with what is committed.
 *
 * PNGs are encoded here rather than by resvg, for two reasons: the phone's light icon must not
 * carry an alpha channel at all, which resvg cannot leave out, and the bytes stay this file's.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'
import { Resvg } from '@resvg/resvg-js'
import { type MarkColours, markElements, ON_ACCENT } from '../web/src/lib/mark.ts'

const at = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url))

const TOKENS = readFileSync(at('packages/web/src/styles/tokens.css'), 'utf8')
function token(name: string): string {
  const value = TOKENS.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`, 'i'))?.[1]
  if (!value) throw new Error(`tokens.css has no ${name}`)
  return value
}
const ACCENT = token('--accent')
const GROUND = token('--ground')

/** Brighter than the accent, which is too dark to hold against iOS's near-black. */
const DARK: MarkColours = { ink: '#1fb57f', fold: 0.72 }
/** iOS reads only brightness: white is full tint, the fold a little less. */
const TINTED: MarkColours = { ink: '#ffffff', fold: 0.72 }

type Tile = {
  colours: MarkColours
  /** No ground at all when absent: iOS draws one behind the dark and tinted looks. */
  ground?: string
  /** Rounded for a favicon, which nothing else will round; square where the system masks it. */
  radius?: number
  /** Shrinks the mark about the tile's centre, for a maskable icon's safe zone. */
  scale?: number
}

function svg({ colours, ground, radius = 0, scale = 1 }: Tile): string {
  const tile = ground ? `<rect width="100" height="100" rx="${radius}" fill="${ground}"/>` : ''
  // The map's box is 14–86 × 20–86: centred across, a little low, as drawn.
  const mark = markElements(colours, 'route')
  const placed =
    scale === 1
      ? mark
      : `<g transform="translate(50 50) scale(${scale}) translate(-50 -53)">${mark}</g>`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Tracks</title>${tile}${placed}</svg>\n`
}

/** A PNG of `size` pixels, RGB when `opaque` and RGBA otherwise. */
function png(tile: Tile, size: number, opaque = false): Buffer {
  const image = new Resvg(svg(tile), {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false },
  }).render()
  // Premultiplied, as resvg keeps them; PNG wants each colour on its own.
  const rgba = image.pixels
  const channels = opaque ? 3 : 4
  const rows = Buffer.alloc(size * (1 + size * channels))
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * channels)
    for (let x = 0; x < size; x++) {
      const pixel = (y * size + x) * 4
      const alpha = rgba[pixel + 3]!
      for (let c = 0; c < channels; c++) {
        const value = rgba[pixel + c]!
        rows[row + 1 + x * channels + c] =
          c === 3 || alpha === 0 || alpha === 255 ? value : Math.round((value * 255) / alpha)
      }
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(opaque ? 2 : 6, 9)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const json = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)

const CATALOG = 'app/iosApp/iosApp/Assets.xcassets'
const ICONSET = `${CATALOG}/AppIcon.appiconset`
/** Linked from index.html, so Vite hashes them and the edge may cache them for a year. */
const WEB = 'packages/web/src/icon'
/**
 * Named from inside the manifest, which Vite does not rewrite, so these keep their names and are
 * served no-store. Only a browser installing or refreshing the manifest asks for them.
 */
const PUBLIC = 'packages/web/public/icons'

/** Every file, by its path from the repository root. */
export function generateAppIcons(): Map<string, Buffer> {
  const light: Tile = { colours: ON_ACCENT, ground: ACCENT }
  const rounded: Tile = { ...light, radius: 22 }
  const ios = (filename: string, appearance?: string) => ({
    ...(appearance ? { appearances: [{ appearance: 'luminosity', value: appearance }] } : {}),
    filename,
    idiom: 'universal',
    platform: 'ios',
    size: '1024x1024',
  })

  return new Map([
    [`${CATALOG}/Contents.json`, json({ info: { author: 'xcode', version: 1 } })],
    [
      `${ICONSET}/Contents.json`,
      json({
        images: [
          ios('AppIcon.png'),
          ios('AppIcon-dark.png', 'dark'),
          ios('AppIcon-tinted.png', 'tinted'),
        ],
        info: { author: 'xcode', version: 1 },
      }),
    ],
    [`${ICONSET}/AppIcon.png`, png(light, 1024, true)],
    [`${ICONSET}/AppIcon-dark.png`, png({ colours: DARK }, 1024)],
    [`${ICONSET}/AppIcon-tinted.png`, png({ colours: TINTED }, 1024)],

    [`${WEB}/favicon.svg`, Buffer.from(svg(rounded))],
    // Square: iOS rounds a touch icon itself.
    [`${WEB}/apple-touch-icon.png`, png(light, 180, true)],
    [
      `${WEB}/manifest.webmanifest`,
      json({
        name: 'Tracks',
        short_name: 'Tracks',
        start_url: '/',
        // The phone app owns tracks.stho.net's links; a home-screen shortcut is only a bookmark.
        display: 'browser',
        theme_color: ACCENT,
        background_color: GROUND,
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      }),
    ],
    [`${PUBLIC}/icon-192.png`, png(rounded, 192)],
    [`${PUBLIC}/icon-512.png`, png(rounded, 512)],
    // The safe zone is a circle of 40% radius; at 0.8 the map's corners reach 39%.
    [`${PUBLIC}/maskable-512.png`, png({ ...light, scale: 0.8 }, 512, true)],
  ])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [path, body] of generateAppIcons()) {
    mkdirSync(dirname(at(path)), { recursive: true })
    writeFileSync(at(path), body)
    console.log(`wrote ${path}`)
  }
}
