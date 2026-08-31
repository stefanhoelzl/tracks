import { useId } from 'react'
import { Histogram } from './Histogram.tsx'
import styles from './RangeSlider.module.css'

/**
 * A dual-handle range, chosen on its own distribution.
 *
 * The bars and the handles are one control, not a chart with a bar underneath it: the
 * shape you are reading is the thing you are cutting, so the cut is made on it. What
 * dims outside the selection is a wash drawn in chart space, which means the edge sits
 * exactly where the handle does rather than at the nearest bucket boundary.
 *
 * The handles themselves are still two stacked `<input type="range">`. Keyboard
 * support, screen-reader semantics and pointer capture all arrive for free, and the
 * only cost is the pointer-events dance that lets the upper one reach the lower —
 * which is a better trade than re-deriving all three on top of a chart library.
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
  buckets,
  onChange,
  format,
  label,
}: {
  axisMin: number
  axisMax: number
  /** Null means unbounded on that side. */
  min: number | null
  max: number | null
  /** Equal-width counts across the axis, drawn behind the handles. */
  buckets: readonly number[]
  onChange: (next: { min: number | null; max: number | null }) => void
  format: (value: number) => string
  label: string
}) {
  const id = useId()
  const span = axisMax - axisMin

  // A degenerate axis — one activity in scope, or all of them identical — has nothing
  // to slide along and nothing to distribute, so it shows the value instead of a dead
  // control and a single bar standing in for a shape.
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
      <div className={styles.plot}>
        <div className={styles.bars} aria-hidden="true">
          <Histogram buckets={buckets} axisMin={axisMin} axisMax={axisMax} low={low} high={high} />
        </div>

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
      </div>

      <div className={styles.bounds}>
        <span className={min === null ? styles.unbounded : undefined}>{format(low)}</span>
        <span className={max === null ? styles.unbounded : undefined}>{format(high)}</span>
      </div>
    </div>
  )
}
