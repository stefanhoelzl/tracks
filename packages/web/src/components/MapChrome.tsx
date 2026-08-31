import { Map as MapIcon, Maximize, Minus, Plus, Satellite, Ungroup } from 'lucide-react'
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
  basemap,
  canFitAll,
  onToggleGrouping,
  onToggleBasemap,
  onFitAll,
  onZoom,
  insetRight,
  insetLeft,
}: {
  grouped: boolean
  basemap: 'map' | 'satellite'
  /** False when nothing outside the viewport matches, so there is nowhere to fly to. */
  canFitAll: boolean
  onToggleGrouping: () => void
  onToggleBasemap: () => void
  onFitAll: () => void
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
        {/* The viewport is always the filter, so widening it is how you get back to
            everything — a camera move, not a filter you clear. */}
        <button
          type="button"
          className={styles.group}
          onClick={onFitAll}
          disabled={!canFitAll}
          aria-label="Zoom out to all activities"
          title="Zoom out to all activities"
        >
          <Maximize size={17} strokeWidth={2} />
        </button>

        {/* Names what you would get, not what you have: an icon showing the state you
            are already in has nothing to tell you. */}
        <button
          type="button"
          className={styles.group}
          onClick={onToggleBasemap}
          aria-label={basemap === 'map' ? 'Show satellite imagery' : 'Show the map'}
          title={basemap === 'map' ? 'Show satellite imagery' : 'Show the map'}
          aria-pressed={basemap === 'satellite'}
        >
          {basemap === 'map' ? (
            <Satellite size={17} strokeWidth={2} />
          ) : (
            <MapIcon size={17} strokeWidth={2} />
          )}
        </button>

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
