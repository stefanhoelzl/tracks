import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
 * There are two ways to cut. **Drag across the bars** to say "this part of the shape",
 * which is the gesture the distribution invites and takes one movement instead of two;
 * the handles below are for adjusting an end afterwards, and for reaching the control
 * at all without a pointer. They are still two stacked `<input type="range">`, so
 * keyboard support, screen-reader semantics and pointer capture arrive for free, and
 * the drag is a shortcut over them rather than a replacement — which is why it needs
 * no ARIA of its own.
 *
 * The contract the rest of the app depends on: **an end parked at the end of its
 * track means unbounded, not "at the current maximum"**. Axes are computed from the
 * self-excluded filter, so they move when another facet changes — and an end that
 * had silently latched onto the old maximum would become a cap the user never set.
 * A drag that finishes on an axis end therefore writes null, exactly as a handle does.
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
  const brush = useRef<HTMLDivElement>(null)

  /**
   * The drag in progress, in axis units. Held here rather than pushed through
   * `onChange` on every pointer move: a range facet is four queries, and a drag across
   * 300px would ask for all of them a hundred times on the way past. The wash, the
   * fill and the readout all follow this instead, so the shape responds continuously
   * and the filter is written once, on release.
   */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)

  // Abandoning a drag has to be possible once it has started, because it is writing a
  // filter and the only other way out is to commit one.
  useEffect(() => {
    if (!drag) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrag(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drag])

  const span = axisMax - axisMin
  const step = span / 200

  /** Null when there is nothing laid out yet to measure against. */
  const valueAt = useCallback(
    (clientX: number): number | null => {
      const box = brush.current?.getBoundingClientRect()
      if (!box || box.width === 0) return null
      const fraction = (clientX - box.left) / box.width
      return axisMin + Math.min(1, Math.max(0, fraction)) * span
    },
    [axisMin, span],
  )

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

  /** Snapping to the end means unbounded, which is also what makes it reachable. */
  const bound = (value: number, edge: number) => (Math.abs(value - edge) < step ? null : value)

  /**
   * What the control shows: the drag while there is one, the filter otherwise.
   *
   * Both ends move together during a drag, which is what separates this gesture from
   * the handles — you are drawing a range rather than adjusting one of its sides.
   */
  const low = drag ? Math.min(drag.from, drag.to) : (min ?? axisMin)
  const high = drag ? Math.max(drag.from, drag.to) : (max ?? axisMax)

  const pct = (value: number) => ((value - axisMin) / span) * 100

  const commit = (from: number, to: number) => {
    const lo = Math.min(from, to)
    const hi = Math.max(from, to)

    // Narrower than a step is a click, not a drag. Selecting the sliver it describes
    // would match nothing; clearing is the only other thing a click on a distribution
    // could mean, and it gives the gesture its own undo.
    if (hi - lo < step) {
      onChange({ min: null, max: null })
      return
    }
    onChange({ min: bound(lo, axisMin), max: bound(hi, axisMax) })
  }

  return (
    <div className={styles.root}>
      <div className={styles.plot}>
        <div className={styles.bars} aria-hidden="true">
          <Histogram buckets={buckets} axisMin={axisMin} axisMax={axisMax} low={low} high={high} />
        </div>

        {/*
          The drag surface, over the bars and stopping short of the handles so a grab
          at a thumb still reaches it. Presentational on purpose: it does the same job
          as the two sliders below, which are the accessible way to do it.
        */}
        <div
          ref={brush}
          className={styles.brush}
          data-testid={`${label}-brush`}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            const value = valueAt(event.clientX)
            if (value === null) return
            event.currentTarget.setPointerCapture?.(event.pointerId)
            setDrag({ from: value, to: value })
          }}
          onPointerMove={(event) => {
            if (!drag) return
            const value = valueAt(event.clientX)
            if (value !== null) setDrag({ from: drag.from, to: value })
          }}
          onPointerUp={(event) => {
            event.currentTarget.releasePointerCapture?.(event.pointerId)
            if (!drag) return
            commit(drag.from, drag.to)
            setDrag(null)
          }}
          // A cancelled drag is an abandoned one — the pointer was taken away rather
          // than lifted, and nothing was decided.
          onPointerCancel={() => setDrag(null)}
        />

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
        {/* While dragging, both ends are values you are choosing right now — neither is
            the axis standing in for one you never set. */}
        <span className={!drag && min === null ? styles.unbounded : undefined}>{format(low)}</span>
        <span className={!drag && max === null ? styles.unbounded : undefined}>{format(high)}</span>
      </div>
    </div>
  )
}
