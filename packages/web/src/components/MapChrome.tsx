import { Minus, Plus, Ungroup } from 'lucide-react'
import styles from './MapChrome.module.css'

/**
 * The controls that belong to the map rather than to the data.
 *
 * Spatial filtering is not among them any more: the visible area is always part of the
 * filter, so there is no state to offer and nothing to switch. What is left is the
 * camera itself, and the one choice about how tracks are drawn.
 */
export function MapChrome({
  grouped,
  onToggleGrouping,
  onZoom,
  insetRight,
  insetLeft,
}: {
  grouped: boolean
  onToggleGrouping: () => void
  onZoom: (delta: number) => void
  insetRight: number
  insetLeft: number
}) {
  const label = grouped ? 'Grouping nearby starts' : 'Showing every track'

  return (
    <>
      <div className={styles.zoom} style={{ right: insetRight + 12 }}>
        <button type="button" onClick={() => onZoom(1)} aria-label="Zoom in">
          <Plus size={17} strokeWidth={2} />
        </button>
        <div className={styles.divider} />
        <button type="button" onClick={() => onZoom(-1)} aria-label="Zoom out">
          <Minus size={17} strokeWidth={2} />
        </button>
      </div>

      {/* Centred in whatever the panels leave, along the bottom edge. Grouping trades
          the tracks for a tally at low zoom, so turning it off says "show me the actual
          lines" — which is the whole point of a track map, and why *off* is the lit state. */}
      <div className={styles.grouping} style={{ left: insetLeft, right: insetRight }}>
        <button
          type="button"
          className={[styles.group, grouped ? '' : styles.groupOn].join(' ')}
          onClick={onToggleGrouping}
          aria-label={label}
          title={label}
          aria-pressed={!grouped}
        >
          <Ungroup size={17} strokeWidth={2} />
        </button>
      </div>

      <div className={styles.attribution} style={{ left: insetLeft + 16 }}>
        OpenStreetMap · VersaTiles
      </div>
    </>
  )
}
