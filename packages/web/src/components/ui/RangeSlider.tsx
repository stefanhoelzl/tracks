import { useId } from 'react'
import styles from './RangeSlider.module.css'

/**
 * A dual-handle range over a fixed axis.
 *
 * Two stacked `<input type="range">` rather than a hand-rolled drag: keyboard
 * support, screen-reader semantics and pointer capture all arrive for free, and the
 * only cost is the pointer-events dance that lets the upper one reach the lower.
 *
 * The contract the rest of the app depends on: **a handle parked at the end of its
 * track means unbounded, not "at the current maximum"**. Axes are computed from the
 * self-excluded filter, so they move when another facet changes — and a handle that
 * had silently latched onto the old maximum would become a cap the user never set.
 */
export function RangeSlider({
  axisMin,
  axisMax,
  min,
  max,
  onChange,
  format,
  label,
}: {
  axisMin: number
  axisMax: number
  /** Null means unbounded on that side. */
  min: number | null
  max: number | null
  onChange: (next: { min: number | null; max: number | null }) => void
  format: (value: number) => string
  label: string
}) {
  const id = useId()
  const span = axisMax - axisMin

  // A degenerate axis — one activity in scope, or all of them identical — has
  // nothing to slide along, so it shows the value instead of a dead control.
  if (span <= 0) {
    return (
      <div className={styles.single}>
        <span>{format(axisMin)}</span>
      </div>
    )
  }

  const low = min ?? axisMin
  const high = max ?? axisMax
  const step = span / 200

  const pct = (value: number) => ((value - axisMin) / span) * 100

  /** Snapping to the end means unbounded, which is also what makes it reachable. */
  const bound = (value: number, edge: number) => (Math.abs(value - edge) < step ? null : value)

  return (
    <div className={styles.root}>
      <div className={styles.track}>
        <div className={styles.rail} />
        <div
          className={styles.fill}
          style={{ left: `${pct(low)}%`, right: `${100 - pct(high)}%` }}
        />

        <input
          type="range"
          className={styles.input}
          aria-label={`${label} minimum`}
          id={`${id}-min`}
          min={axisMin}
          max={axisMax}
          step={step}
          value={low}
          onChange={(e) => {
            const next = Math.min(Number(e.target.value), high)
            onChange({ min: bound(next, axisMin), max })
          }}
        />
        <input
          type="range"
          className={styles.input}
          aria-label={`${label} maximum`}
          id={`${id}-max`}
          min={axisMin}
          max={axisMax}
          step={step}
          value={high}
          onChange={(e) => {
            const next = Math.max(Number(e.target.value), low)
            onChange({ min, max: bound(next, axisMax) })
          }}
        />
      </div>

      <div className={styles.bounds}>
        <span className={min === null ? styles.unbounded : undefined}>{format(low)}</span>
        <span className={max === null ? styles.unbounded : undefined}>{format(high)}</span>
      </div>
    </div>
  )
}
