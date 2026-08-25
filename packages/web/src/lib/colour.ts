/**
 * Colour by value, from a hash.
 *
 * The alternative — assigning colours from whatever is currently on screen — makes
 * every track change colour as you filter, which is exactly when you are trying to
 * compare them. Hashing `type:value` costs a possible collision between two visible
 * values and buys a colour that belongs to a trip for as long as the trip exists,
 * with nothing to store and no registry edit to make a new one visible.
 */

const PALETTE_SIZE = 10

/** FNV-1a. Small, well-distributed on short strings, and identical everywhere. */
function hash(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Resolved from the token layer once, so the palette still lives in CSS. */
let palette: string[] | null = null
let noneColour = '#8a9691'

export function readPalette(root: HTMLElement = document.documentElement): void {
  const styles = getComputedStyle(root)
  palette = Array.from({ length: PALETTE_SIZE }, (_, i) =>
    styles.getPropertyValue(`--cat-${i}`).trim(),
  )
  noneColour = styles.getPropertyValue('--cat-none').trim() || noneColour
}

/** The neutral used for *not set*, and for tracks when nothing is being coloured. */
export function neutralColour(): string {
  return noneColour
}

export function colourFor(tag: string): string {
  if (!palette) readPalette()
  return palette![hash(tag) % PALETTE_SIZE]!
}

/**
 * What an activity is coloured, given the current selector.
 *
 * `colourBy` is a tag type name, `year`, or null. A multi-valued type colours by its
 * lowest-sorted value — arrays are stored sorted, so that is simply the first match,
 * and the legend says which one won.
 */
export function activityColour(
  tags: readonly string[],
  year: number,
  colourBy: string | null,
): string {
  if (colourBy === null) return neutralColour()
  if (colourBy === 'year') return colourFor(`year:${year}`)

  const prefix = `${colourBy}:`
  const tag = tags.find((t) => t.startsWith(prefix))
  return tag === undefined ? neutralColour() : colourFor(tag)
}
