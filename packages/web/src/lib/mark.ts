/**
 * The folded map: Tracks' mark, in the top bar, the browser tab and on the phone's home screen.
 *
 * Three panels of a paper map folded like a zigzag, the middle one turned from the light, with a
 * route cut clean through all three. Drawn on a 100-unit square. The route is a hole, not a line
 * in the ground colour, so the mark sits on any ground — the green tile, iOS's own dark gradient,
 * or nothing at all for the tinted icon.
 *
 * `packages/scripts/app-icon.ts` renders every icon file from this; the top bar draws it directly.
 */

export const PANELS = [
  'M14 28 L38 20 L38 78 L14 86Z',
  'M38 20 L62 28 L62 86 L38 78Z',
  'M62 28 L86 20 L86 78 L62 86Z',
] as const

export const ROUTE = 'M22 72 C32 62 42 40 54 48 S70 38 78 30'
export const ROUTE_WIDTH = 5.5

export type MarkColours = {
  /** The panels. */
  ink: string
  /** How much of `ink` the middle panel keeps: the fold. */
  fold: number
}

/** White on the accent: the favicon, the top bar and the phone's light icon. */
export const ON_ACCENT: MarkColours = { ink: '#ffffff', fold: 0.78 }

/**
 * The mark as SVG elements, without the `<svg>` around them. `id` names the mask that cuts the
 * route, and has to be unique within the document it lands in.
 */
export function markElements({ ink, fold }: MarkColours, id: string): string {
  const panels = PANELS.map(
    (d, i) => `<path d="${d}" fill="${ink}"${i === 1 ? ` fill-opacity="${fold}"` : ''}/>`,
  ).join('')
  return (
    `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">` +
    `<rect width="100" height="100" fill="#fff"/>` +
    `<path d="${ROUTE}" fill="none" stroke="#000" stroke-width="${ROUTE_WIDTH}" stroke-linecap="round"/>` +
    `</mask><g mask="url(#${id})">${panels}</g>`
  )
}
