import type { LatLon, Leg, Place } from '@tracks/routing'
import { PROFILE_LABELS, PROFILES } from '@tracks/routing'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { km, metres } from '../lib/format.ts'
import type { Plan } from '../lib/plan.ts'
import { legCount, moveStop, type Placement } from '../lib/plan-ops.ts'
import { readingsFrom } from '../lib/plan-track.ts'
import { PlaceSearch } from './PlaceSearch.tsx'
import { Label } from './ui/Label.tsx'
import { WaypointMark } from './ui/Waypoint.tsx'
import styles from './WaypointPanel.module.css'

/** How long a finger rests on a stop before it is picked up — the map's own rule. */
const LONG_PRESS_MS = 450
/** How far it may wander meanwhile before it counts as scrolling. */
const PRESS_SLOP_PX = 8

/**
 * Everything that *changes* a plan: where to add a place, how it is routed, and the
 * stops themselves.
 *
 * It sits under the plan's numbers in the right-hand panel rather than on the left. The
 * left panel is the filter in every mode, so only one side of the map changes when the
 * mode does — and the filter stays where it was, still narrowing the tracks underneath
 * a plan, which is most of the reason to plan on this map at all.
 *
 * The list mirrors the leg structure rather than the waypoint array. Each **stop** is a
 * row carrying the distance and the climb to it; the shaping points inside a leg are
 * ticks on the connector between two rows. A plan with fifteen hints and two real places
 * then reads as the trip it is, rather than as seventeen anonymous entries.
 *
 * Those numbers are measured from whichever row is under the pointer, and from the first
 * stop when none is. "How far is the hut from here" is what a list of stops is usually
 * being asked, and *here* is rarely the beginning.
 *
 * The profile lives here rather than on the map chrome: it belongs to the plan, travels
 * in the fragment with it, and choosing it is a decision about the trip rather than
 * about the view.
 */
export function WaypointPanel({
  plan,
  legs,
  pending,
  error,
  near,
  onPlan,
  onSelect,
  onRemove,
  onPick,
  onAddPlace,
  onHoverPlace,
}: {
  plan: Plan
  legs: Array<Leg | undefined>
  /** A leg is in flight. The map has already drawn the beeline it will replace. */
  pending: boolean
  /** The engine refusing or unreachable — not a leg that could not be routed. */
  error: string | null
  /** The map centre, read at request time: the camera moves between keystrokes. */
  near: () => LatLon | null
  onPlan: (plan: Plan) => void
  onSelect: (index: number) => void
  /** Removing from the list, so a waypoint off screen is still reachable. */
  onRemove: (index: number) => void
  onPick: (place: Place) => void
  onAddPlace: (place: Place, placement: Placement) => void
  onHoverPlace: (place: Place | null) => void
}) {
  /** Which stop is being dragged, as a POI ordinal. Transient, and never in the URL. */
  const [dragging, setDragging] = useState<number | null>(null)
  /** Which stop the distances are measured from. Also a POI ordinal, also transient. */
  const [base, setBase] = useState<number | null>(null)

  const readings = readingsFrom(legs, base ?? 0)

  /**
   * A finger has no hover, so on touch the tap does what the pointer's arrival does: the
   * first tap on a row measures the others from it, and a tap on the row already measured
   * from opens its dialog, as a click does. Whether the row was the base is read when the
   * finger lands, because the focus and the emulated mouse events that follow re-base it
   * before the click arrives.
   */
  const touch = useRef<{ ordinal: number; wasBase: boolean } | null>(null)

  /**
   * Reordering by finger: a long press picks the stop up, it follows the finger, and the
   * stops it passes ease aside to make room where it will land — the phone app's gesture,
   * where the platform's drag and drop is mouse-only. A stop carries the shaping points
   * that lead out of it, as `moveStop` moves them. The rows are moved by transforms written
   * straight to them, so nothing re-renders while a finger moves. Listeners are the DOM's
   * own rather than React's, because React's `touchmove` is passive and the page must not
   * scroll under a stop being carried.
   */
  // A node in state rather than a ref: the list is only there once the plan has a stop, so
  // the listeners are attached when it appears.
  const [list, setList] = useState<HTMLOListElement | null>(null)
  const live = useRef({ plan, onPlan })
  live.current = { plan, onPlan }
  useEffect(() => {
    const node = list
    if (!node) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let start: { x: number; y: number; ordinal: number } | null = null
    let carrying: number | null = null
    let over: number | null = null
    /** Each stop's block — its row and its ticks — and where it rests, measured at pick-up. */
    let blocks: Array<{ rows: HTMLElement[]; top: number; bottom: number }> = []

    const measure = () => {
      blocks = []
      for (const row of node.querySelectorAll<HTMLElement>('[data-block]')) {
        const ordinal = Number(row.dataset.block)
        const box = row.getBoundingClientRect()
        const block = blocks[ordinal] ?? { rows: [], top: box.top, bottom: box.bottom }
        blocks[ordinal] = block
        block.rows.push(row)
        block.top = Math.min(block.top, box.top)
        block.bottom = Math.max(block.bottom, box.bottom)
      }
    }
    /** The carried block follows the finger; the ones between it and where it would land make room. */
    const arrange = (dy: number) => {
      const lifted = carrying
      if (lifted === null) return
      const carried = blocks[lifted]
      if (!carried) return
      const height = carried.bottom - carried.top
      blocks.forEach((block, ordinal) => {
        const shift =
          ordinal === lifted
            ? dy
            : over !== null && lifted < ordinal && ordinal <= over
              ? -height
              : over !== null && over <= ordinal && ordinal < lifted
                ? height
                : 0
        for (const row of block.rows) {
          row.style.transform = shift === 0 ? '' : `translateY(${shift}px)`
          row.style.transition = ordinal === lifted ? 'none' : ''
          row.style.zIndex = ordinal === lifted ? '1' : ''
        }
      })
    }
    const reset = () => {
      clearTimeout(timer)
      start = null
      carrying = null
      over = null
      for (const block of blocks) {
        for (const row of block.rows) {
          row.style.transform = ''
          row.style.transition = ''
          row.style.zIndex = ''
        }
      }
      blocks = []
      setDragging(null)
    }

    const onStart = (event: TouchEvent) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-stop]')
      const finger = event.touches[0]
      if (!row || !finger || event.touches.length !== 1) return reset()
      start = { x: finger.clientX, y: finger.clientY, ordinal: Number(row.dataset.stop) }
      timer = setTimeout(() => {
        if (!start) return
        carrying = start.ordinal
        over = start.ordinal
        measure()
        setDragging(carrying)
        navigator.vibrate?.(10)
      }, LONG_PRESS_MS)
    }
    const onMove = (event: TouchEvent) => {
      const finger = event.touches[0]
      if (!finger || !start) return
      if (carrying === null) {
        // Moving first is scrolling the list, which is what the finger was doing.
        if (Math.hypot(finger.clientX - start.x, finger.clientY - start.y) > PRESS_SLOP_PX) reset()
        return
      }
      event.preventDefault()
      // Where it would land is the block its middle is over, measured where the blocks rest.
      const carried = blocks[carrying]
      if (carried) {
        const middle = (carried.top + carried.bottom) / 2 + (finger.clientY - start.y)
        const landing = blocks.findIndex((block) => block && middle < block.bottom)
        over = landing === -1 ? blocks.length - 1 : landing
      }
      arrange(finger.clientY - start.y)
    }
    const onEnd = (event: TouchEvent) => {
      if (carrying !== null) {
        // The lift that ends a carry is not also a tap on the row it lands on.
        event.preventDefault()
        if (over !== null && over !== carrying) {
          live.current.onPlan(moveStop(live.current.plan, carrying, over))
        }
      }
      reset()
    }

    node.addEventListener('touchstart', onStart, { passive: true })
    node.addEventListener('touchmove', onMove, { passive: false })
    node.addEventListener('touchend', onEnd)
    node.addEventListener('touchcancel', reset)
    return () => {
      clearTimeout(timer)
      node.removeEventListener('touchstart', onStart)
      node.removeEventListener('touchmove', onMove)
      node.removeEventListener('touchend', onEnd)
      node.removeEventListener('touchcancel', reset)
    }
  }, [list])

  // Walked once: a row is a POI, and it needs both where it sits in the waypoint array
  // (every edit addresses that) and which leg arrives at it.
  let stop = -1
  const rows = plan.waypoints.map((waypoint, index) => {
    if (waypoint.kind === 'poi') stop += 1
    return { waypoint, index, stop }
  })

  return (
    <div className={styles.section}>
      {error ? (
        <div className={styles.banner}>
          <strong>The router is not answering</strong>
          <span>{error}</span>
        </div>
      ) : null}

      {/* How the plan is routed, straight under the numbers it produces; then where to add a
          place, straight over the stops it adds to. The phone app's order, and so this one. */}
      <div className={styles.group}>
        <Label>Profile</Label>
        <div className={styles.profiles}>
          {PROFILES.map((profile) => (
            <button
              key={profile}
              type="button"
              className={[styles.profile, plan.profile === profile ? styles.profileOn : ''].join(
                ' ',
              )}
              aria-pressed={plan.profile === profile}
              onClick={() => onPlan({ ...plan, profile })}
            >
              {PROFILE_LABELS[profile]}
            </button>
          ))}
        </div>
      </div>

      {/* The same placements the pinned dialog offers, in the same order — a searched
          place is almost always a stop, so saying which kind of stop is the whole of
          the decision and the dialog adds nothing to it. */}
      <PlaceSearch
        near={near}
        placements={
          plan.waypoints.length === 0
            ? [{ placement: 'end', label: 'Add' }]
            : [
                { placement: 'start' as Placement, label: 'Start' },
                ...(legCount(plan) > 0
                  ? [{ placement: 'nearest' as Placement, label: 'Insert' }]
                  : []),
                { placement: 'end' as Placement, label: 'End' },
              ]
        }
        onPick={onPick}
        onAdd={onAddPlace}
        onHover={onHoverPlace}
      />

      {plan.waypoints.length === 0 ? (
        // In the words of whatever is pointing: a mouse clicks and drags the line, a finger taps
        // and holds the map, as it does in the phone app. Both are written, and the input picks.
        <div className={styles.empty}>
          <div className={styles.forMouse}>
            <strong>Click the map to start</strong>
            <span>
              The first two points are the start and the end. After that you can add stops, or drag
              the line to shape the route.
            </span>
          </div>
          <div className={styles.forFinger}>
            <strong>Tap the map to start</strong>
            <span>
              The first two points are the start and the end. After that you can add stops, or
              long-press the map to shape the route.
            </span>
          </div>
        </div>
      ) : (
        <div className={styles.group}>
          <Label>Route</Label>
          {/* Cleared on the way out of the list rather than per row: moving between
              rows crosses the gaps between them, and re-basing to the first stop for a
              frame each time would make the numbers flicker. */}
          <ol ref={setList} className={styles.list} onMouseLeave={() => setBase(null)}>
            {rows.map(({ waypoint, index, stop: ordinal }, at) => {
              const reading = readings[ordinal]
              // The glyph says which end of the line this is, in the same four marks the
              // dialog offers and the phone draws.
              const glyph = at === 0 ? 'start' : at === rows.length - 1 ? 'end' : 'mid'

              return waypoint.kind === 'poi' ? (
                <li
                  key={index}
                  data-stop={ordinal}
                  data-block={ordinal}
                  onMouseEnter={() => setBase(ordinal)}
                  // Native drag rather than a library: a dozen rows on one axis, and the
                  // platform already carries the drag image and the drop target.
                  draggable
                  onDragStart={() => setDragging(ordinal)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragging !== null) onPlan(moveStop(plan, dragging, ordinal))
                    setDragging(null)
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={[
                    styles.row,
                    base === ordinal ? styles.rowBase : '',
                    dragging === ordinal ? styles.rowDragging : '',
                  ].join(' ')}
                >
                  <button
                    type="button"
                    className={styles.rowButton}
                    // Focus re-bases too, so the list is not a mouse-only readout.
                    onFocus={() => setBase(ordinal)}
                    onPointerDown={(event) => {
                      touch.current =
                        event.pointerType === 'touch'
                          ? { ordinal, wasBase: base === ordinal }
                          : null
                    }}
                    onClick={() => {
                      const tapped = touch.current
                      touch.current = null
                      if (tapped?.ordinal === ordinal && !tapped.wasBase) setBase(ordinal)
                      else onSelect(index)
                    }}
                  >
                    <WaypointMark glyph={glyph} size={17} className={styles.glyph} />
                    <span className={styles.name}>{waypoint.name ?? 'Unnamed stop'}</span>
                    {/* The row being measured from carries no numbers, which is what
                        the first row always did. A leg that failed shows a dash: the
                        gap is unknown, and saying 12.4 km would be quietly wrong. */}
                    {reading ? (
                      <span className={styles.meta}>
                        {reading.incomplete
                          ? '—'
                          : `${km(reading.distanceM)} km · ${metres(reading.ascentM)} m up`}
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={`Remove ${waypoint.name ?? 'stop'}`}
                    onClick={() => onRemove(index)}
                  >
                    <X size={12} strokeWidth={2.4} />
                  </button>
                </li>
              ) : (
                <li key={index} className={styles.tick} data-block={ordinal}>
                  <button
                    type="button"
                    className={styles.tickButton}
                    onClick={() => onSelect(index)}
                  >
                    <WaypointMark glyph="shape" size={15} className={styles.glyph} />
                    Shaping point
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label="Remove shaping point"
                    onClick={() => onRemove(index)}
                  >
                    <X size={11} strokeWidth={2.4} />
                  </button>
                </li>
              )
            })}
          </ol>
          {pending ? <div className={styles.pending}>Routing…</div> : null}
        </div>
      )}
    </div>
  )
}
