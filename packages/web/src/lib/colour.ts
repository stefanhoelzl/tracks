/**
 * Colour by value.
 *
 * A plain hash of `type:value` into ten slots was the first design, and it collided
 * on the first data it met: `sport:bike` and `sport:hike` landed on the same green,
 * which makes the map useless for exactly the comparison it exists to support. With
 * three values in ten slots the odds of *some* collision are about one in four — not
 * a bet worth taking on the most-used facet in the app.
 *
 * So the hash is a *preference* now, not a verdict. Each type's values are laid out
 * over the palette once: every value asks for its hashed slot and takes the next free
 * one if that is occupied. This keeps everything the hash bought — a colour that
 * belongs to a trip for as long as the trip exists, nothing stored, no registry edit
 * needed to make a new value visible — and drops the one thing it cost.
 *
 * The layout depends on the type's *value set*, never on what is currently drawn. For
 * an enum that set is the registry's own declaration; for a free string it is the
 * self-excluded facet list, which by construction does not change when you filter by
 * that same type. Filtering by sport therefore never repaints the sports.
 */

/**
 * Ten hues that hold up against a grey basemap and against each other; the first
 * three are the validated bike/hike/run set from the design canvas.
 *
 * Here rather than in the token file because nothing in CSS reads it: it is painted
 * into GeoJSON properties and passed as props. Reading it back out of custom
 * properties would add a round trip whose only failure mode is silent — an empty
 * string is a valid CSS value and an invisible track.
 */
const PALETTE = [
  '#0a6b48',
  '#ce7a0c',
  '#2f63c6',
  '#b0304b',
  '#7a4fbf',
  '#0e7c86',
  '#8a6d1f',
  '#c2571a',
  '#4a7a2b',
  '#a0357e',
]

/** Not a category: what *not set* and an uncoloured track are drawn in. */
const NEUTRAL = '#8a9691'

/** How many slots a cluster tally has to account for, plus one for *not set*. */
export const PALETTE_SIZE = PALETTE.length

/** The slot *not set* occupies. It is not a hue, and nothing probes into it. */
export const NEUTRAL_SLOT = PALETTE_SIZE

/** FNV-1a. Small, well-distributed on short strings, and identical everywhere. */
function hash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The neutral used for *not set*, and for tracks when nothing is being coloured. */
export function neutralColour(): string {
  return NEUTRAL
}

export function colourForSlot(slot: number): string {
  return slot === NEUTRAL_SLOT ? NEUTRAL : PALETTE[slot % PALETTE_SIZE]!
}

/** The slot a value asks for, before anyone else has claimed anything. */
export function preferredSlot(tag: string): number {
  return hash(tag) % PALETTE_SIZE
}

/**
 * The group the tag *type* names are laid out in, so a type's own swatch is hashed and
 * unjammed exactly like a value's.
 *
 * A sentinel rather than a name a type could take: the grammar forbids `#` in a type,
 * so this can never collide with a real one.
 */
export const TYPE_GROUP = '#type'

/** One type, and every value of it that exists. */
export interface ColourGroup {
  type: string
  values: readonly string[]
}

export interface ColourScale {
  slot(type: string, value: string): number
  colour(type: string, value: string): string
  /** For a whole tag string, `<type>:<value>`. */
  colourForTag(tag: string): string
}

/**
 * Lays each type's values out over the palette: hashed first, probed on collision.
 *
 * Values are sorted before assignment so the result depends on the *set* and not on
 * the order it arrived in — two responses listing the same values differently must
 * not repaint the map.
 *
 * More values than slots is allowed, and wraps: past ten, two values of one type
 * share a colour again. That is a real limit in the honest place for it — an archive
 * with eleven trips gets one repeat rather than a broken layout.
 */
export function buildScale(groups: readonly ColourGroup[]): ColourScale {
  const assigned = new Map<string, Map<string, number>>()

  for (const group of groups) {
    const slots = new Map<string, number>()
    const taken = new Set<number>()

    for (const value of [...group.values].sort()) {
      let slot = preferredSlot(`${group.type}:${value}`)
      // Linear probing to the first free slot at or after the preference. Bounded by
      // the palette, so once every slot is taken a value simply keeps its preference.
      for (let step = 0; step < PALETTE_SIZE && taken.has(slot); step++) {
        slot = (slot + 1) % PALETTE_SIZE
      }

      slots.set(value, slot)
      taken.add(slot)
    }
    assigned.set(group.type, slots)
  }

  const slotOf = (type: string, value: string) =>
    assigned.get(type)?.get(value) ?? preferredSlot(`${type}:${value}`)

  return {
    slot: slotOf,
    colour: (type, value) => colourForSlot(slotOf(type, value)),
    colourForTag: (tag) => {
      const at = tag.indexOf(':')
      return at <= 0 ? NEUTRAL : colourForSlot(slotOf(tag.slice(0, at), tag.slice(at + 1)))
    },
  }
}

/** Knows no value sets, so every value keeps its preference — the pre-facets state. */
export const HASHED: ColourScale = buildScale([])

/**
 * What an activity is coloured, given the current selector.
 *
 * `colourBy` is a tag type name or `year`. A multi-valued type colours by its
 * lowest-sorted value — arrays are stored sorted, so that is simply the first match,
 * and the legend says which one won.
 */
export function activitySlot(
  tags: readonly string[],
  year: number,
  colourBy: string | null,
  scale: ColourScale = HASHED,
): number {
  if (colourBy === null) return NEUTRAL_SLOT
  if (colourBy === 'year') return scale.slot('year', String(year))

  const prefix = `${colourBy}:`
  const tag = tags.find((t) => t.startsWith(prefix))
  return tag === undefined ? NEUTRAL_SLOT : scale.slot(colourBy, tag.slice(prefix.length))
}

export function activityColour(
  tags: readonly string[],
  year: number,
  colourBy: string | null,
  scale: ColourScale = HASHED,
): string {
  return colourForSlot(activitySlot(tags, year, colourBy, scale))
}

/**
 * How much of the palette's saturation the emphasised variant keeps, and the band its
 * lightness is pulled into.
 *
 * The band matters more than the shift. The palette runs dark — several entries sit
 * near 23% lightness — so *darkening* the selection is what produced the near-black
 * that lost the colour entirely. Pulling every hue into one narrow, vivid band instead
 * means a selected track looks equally lit whichever colour it happens to be.
 */
const EMPHASIS_SATURATION = 1.45
const EMPHASIS_LIGHTNESS = { shift: 0.15, min: 0.36, max: 0.5 }

function toHsl(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h / 6, s, l]
}

function toHex(h: number, s: number, l: number): string {
  const channel = (t: number) => {
    const x = ((t % 1) + 1) % 1
    const c =
      x < 1 / 6
        ? p2 + (q - p2) * 6 * x
        : x < 1 / 2
          ? q
          : x < 2 / 3
            ? p2 + (q - p2) * (2 / 3 - x) * 6
            : p2
    return Math.round(c * 255)
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p2 = 2 * l - q
  const hex = (v: number) => v.toString(16).padStart(2, '0')
  return `#${hex(channel(h + 1 / 3))}${hex(channel(h))}${hex(channel(h - 1 / 3))}`
}

/**
 * The same colour, turned up.
 *
 * A selected track has to be findable among a dozen others painted exactly like it,
 * and it must still read as *that* colour — so the hue is untouched and only its
 * intensity moves. What tells you which one is selected is the casing and the weight;
 * this is what stops the answer from being "one of those greens, somewhere".
 *
 * A grey stays grey: multiplying a saturation near zero leaves it near zero, which is
 * what *not set* should keep doing.
 */
export function emphasise(hex: string): string {
  const [h, s, l] = toHsl(hex)
  const { shift, min, max } = EMPHASIS_LIGHTNESS
  return toHex(h, Math.min(1, s * EMPHASIS_SATURATION), Math.min(max, Math.max(min, l + shift)))
}
