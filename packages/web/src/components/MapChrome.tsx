import { Frame, Minus, Plus, Ungroup } from 'lucide-react'
import styles from './MapChrome.module.css'

/**
 * The controls that belong to the map rather than to the data.
 *
 * *Filter to this area* is the whole of spatial selection: it turns the camera's own
 * bounds into the filter and freezes auto-fit while it is on, which is why it is one
 * switch and not a draw mode plus a lock.
 */
export function MapChrome({
  areaFilter,
  grouped,
  onToggleArea,
  onToggleGrouping,
  onZoom,
  insetRight,
  insetLeft,
}: {
  areaFilter: boolean
  grouped: boolean
  onToggleArea: () => void
  onToggleGrouping: () => void
  onZoom: (delta: number) => void
  insetRight: number
  insetLeft: number
}) {
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

      <div className={styles.toggles} style={{ right: insetRight + 12 }}>
        <button
          type="button"
          className={[styles.toggle, areaFilter ? styles.toggleOn : ''].join(' ')}
          onClick={onToggleArea}
          aria-pressed={areaFilter}
        >
          <Frame size={15} strokeWidth={2} />
          {areaFilter ? 'Filtering to this area' : 'Filter to this area'}
        </button>

        {/* Grouping trades the tracks for a tally at low zoom. Turning it off says
            "show me the actual lines", which is the whole point of a track map. */}
        <button
          type="button"
          className={[styles.toggle, grouped ? '' : styles.toggleOn].join(' ')}
          onClick={onToggleGrouping}
          aria-pressed={!grouped}
        >
          <Ungroup size={15} strokeWidth={2} />
          {grouped ? 'Grouping nearby starts' : 'Showing every track'}
        </button>
      </div>

      <div className={styles.attribution} style={{ left: insetLeft + 16 }}>
        OpenStreetMap · VersaTiles
      </div>
    </>
  )
}
