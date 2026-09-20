/**
 * What a waypoint is, as four marks rather than four words.
 *
 * `o->` the line leaves here, `->o` it arrives here, `-o-` it passes through and you stop,
 * `o⌒o` a bend in a leg you do not stop at. They are the type buttons in the waypoint dialog
 * and the first thing in every row of the stop list, here and on the phone — the app's one
 * vocabulary for the one thing a plan is made of.
 *
 * The markers on the map are unchanged. A glyph the size of a stop is a worse pin than a dot,
 * and the map already says which end is which by where the line goes.
 *
 * Drawn here rather than taken from lucide, which has no such thing, on lucide's own terms:
 * a 24 grid, stroked at 2.2, round caps and joins. `Icons.kt` draws the same four from the
 * same path data.
 */
export type WaypointGlyph = 'start' | 'end' | 'mid' | 'shape'

/** A circle of radius `r` at (`cx`, `cy`), in the two-arc shape lucide writes one with. */
function dot(cx: number, r: number, cy = 12) {
  return `M${cx + r} ${cy}a${r} ${r} 0 1 0 -${r * 2} 0a${r} ${r} 0 1 0 ${r * 2} 0`
}

const PATHS: Record<WaypointGlyph, string[]> = {
  start: [dot(5, 3), 'M8.2 12h10.6', 'M15 8l4 4-4 4'],
  end: ['M2 12h10.4', 'M9 8l4 4-4 4', dot(19, 3)],
  mid: ['M2 12h6.2', dot(12, 3), 'M15.8 12H22'],
  shape: [dot(4.6, 2.6, 17.4), dot(19.4, 2.6, 17.4), 'M6.6 15.6C8.6 6.6 15.4 6.6 17.4 15.6'],
}

/** What each one is, for a screen reader and for a `title`. */
export const WAYPOINT_LABELS: Record<WaypointGlyph, string> = {
  start: 'Start',
  end: 'End',
  mid: 'Stop',
  shape: 'Shaping point',
}

export function WaypointMark({
  glyph,
  size = 20,
  className,
}: {
  glyph: WaypointGlyph
  size?: number
  className?: string
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[glyph].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
