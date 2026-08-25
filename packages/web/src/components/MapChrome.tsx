import { Frame, Minus, Plus } from 'lucide-react'
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
  onToggleArea,
  onZoom,
  insetRight,
  insetLeft,
}: {
  areaFilter: boolean
  onToggleArea: () => void
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

      <button
        type="button"
        className={[styles.area, areaFilter ? styles.areaOn : ''].join(' ')}
        style={{ right: insetRight + 12 }}
        onClick={onToggleArea}
        aria-pressed={areaFilter}
      >
        <Frame size={15} strokeWidth={2} />
        {areaFilter ? 'Filtering to this area' : 'Filter to this area'}
      </button>

      <div className={styles.attribution} style={{ left: insetLeft + 16 }}>
        OpenStreetMap · VersaTiles
      </div>
    </>
  )
}
