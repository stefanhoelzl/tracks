import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './Sheet.module.css'

export type Detent = 'peek' | 'half' | 'full'

/** Tall enough for a panel's header and its first line, and nothing else. */
const PEEK_PX = 128
/** The gap the sheet keeps below the top bar at full, the same one every panel floats in. */
const GAP_PX = 8
/** Under this a release is a tap on the handle, not a drag. */
const TAP_PX = 6
/** A flick faster than this goes one detent in its direction, wherever it was let go. */
const FLICK_PX_PER_MS = 0.5

const ORDER: Detent[] = ['peek', 'half', 'full']

/** How tall each detent is in a container this tall, below a bar that ends at `top`. */
export function detentHeights(container: number, top: number): Record<Detent, number> {
  const full = Math.max(PEEK_PX, container - top - GAP_PX)
  return {
    peek: Math.min(PEEK_PX, full),
    half: Math.min(Math.max(PEEK_PX, Math.round(container / 2)), full),
    full,
  }
}

/**
 * The phone's one panel: a sheet over the bottom of a full-bleed map.
 *
 * It holds what the right-hand panel holds on the desktop, from the same components, and
 * rests at one of three detents. At full it stops a gap below the top bar rather than
 * covering it, so the chips and the menu are always in reach — `top` is where that bar
 * ends, measured rather than assumed, since it is one row signed out and two signed in.
 *
 * The handle drags it, and a tap on the handle steps it up and round again. While a drag
 * is under way the height is written straight to the node and to `--sheet-h` on the
 * container, so the controls riding on top of it follow without React re-rendering the
 * app sixty times a second; `onHeight` hears only where it comes to rest, which is what
 * the map pads its camera by.
 */
export function Sheet({
  detent,
  top,
  label,
  onDetent,
  onHeight,
  children,
}: {
  detent: Detent
  /** Where the top bar ends, from the top of the container. */
  top: number
  /** Names the region for a screen reader. */
  label: string
  onDetent: (detent: Detent) => void
  onHeight?: (height: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [container, setContainer] = useState(0)
  /** Where the finger started, and how fast it was going when last seen, in px/ms upwards. */
  const drag = useRef<{
    y: number
    height: number
    at: number
    lastY: number
    velocity: number
    moved: boolean
  } | null>(null)

  // The container is the app, whose height changes when a phone's toolbar slides away.
  useLayoutEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    setContainer(parent.clientHeight)
    const observer = new ResizeObserver(() => setContainer(parent.clientHeight))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  const heights = detentHeights(container, top)
  const height = heights[detent]

  const write = (px: number) => {
    const node = ref.current
    if (!node) return
    node.style.height = `${px}px`
    node.parentElement?.style.setProperty('--sheet-h', `${px}px`)
  }

  useLayoutEffect(() => {
    if (!drag.current) write(height)
  })

  useEffect(() => {
    onHeight?.(height)
  }, [height, onHeight])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      y: event.clientY,
      height,
      at: event.timeStamp,
      lastY: event.clientY,
      velocity: 0,
      moved: false,
    }
    ref.current?.toggleAttribute('data-dragging', true)
    ref.current?.parentElement?.toggleAttribute('data-sheet-dragging', true)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state) return
    const dy = event.clientY - state.y
    if (Math.abs(dy) > TAP_PX) state.moved = true
    if (!state.moved) return
    state.velocity = (state.lastY - event.clientY) / Math.max(1, event.timeStamp - state.at)
    state.at = event.timeStamp
    state.lastY = event.clientY
    write(Math.min(heights.full, Math.max(heights.peek, state.height - dy)))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    drag.current = null
    ref.current?.toggleAttribute('data-dragging', false)
    ref.current?.parentElement?.toggleAttribute('data-sheet-dragging', false)
    if (!state) return

    if (!state.moved) {
      // A tap on the handle: one detent up, and from the top back down to the bottom.
      onDetent(ORDER[(ORDER.indexOf(detent) + 1) % ORDER.length] ?? 'half')
      return
    }

    const now = Math.min(
      heights.full,
      Math.max(heights.peek, state.height - (event.clientY - state.y)),
    )
    // A finger that stopped before it lifted was placing the sheet, not throwing it.
    const velocity = event.timeStamp - state.at < 100 ? state.velocity : 0
    let next: Detent
    if (Math.abs(velocity) > FLICK_PX_PER_MS) {
      // A flick goes one step the way it was thrown, from wherever it started.
      const from = ORDER.indexOf(detent)
      next =
        ORDER[Math.max(0, Math.min(ORDER.length - 1, from + (velocity > 0 ? 1 : -1)))] ?? detent
    } else {
      next = ORDER.reduce((best, candidate) =>
        Math.abs(heights[candidate] - now) < Math.abs(heights[best] - now) ? candidate : best,
      )
    }
    if (next === detent) write(height)
    else onDetent(next)
  }

  return (
    <section ref={ref} className={styles.sheet} aria-label={label} data-detent={detent}>
      <div
        className={styles.grab}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          type="button"
          className={styles.handle}
          aria-label={detent === 'full' ? 'Lower the sheet' : 'Raise the sheet'}
          // The pointer handlers above already answered a tap; this is the keyboard's way.
          onClick={(event) => {
            if (event.detail === 0)
              onDetent(ORDER[(ORDER.indexOf(detent) + 1) % ORDER.length] ?? 'half')
          }}
        />
      </div>
      <div className={styles.body}>{children}</div>
    </section>
  )
}
