import type { LatLon, Leg, Place } from '@tracks/routing'
import { PROFILE_LABELS, PROFILES } from '@tracks/routing'
import { X } from 'lucide-react'
import { useState } from 'react'
import { km, metres } from '../lib/format.ts'
import type { Plan } from '../lib/plan.ts'
import { moveStop } from '../lib/plan-ops.ts'
import { cumulative } from '../lib/plan-track.ts'
import { PlaceSearch } from './PlaceSearch.tsx'
import { Label } from './ui/Label.tsx'
import styles from './WaypointPanel.module.css'

/**
 * The left panel while planning, in place of the filters.
 *
 * One left panel whose content follows the mode, rather than two competing for a layout
 * that already says it wants 1100 px. The filter it replaces is still in effect on the
 * dimmed tracks underneath and still visible as the top bar's chips, so nothing here is
 * invisible-but-active — and coming back restores the sidebar untouched, because the
 * filter never left the query string.
 *
 * The list mirrors the leg structure rather than the waypoint array. Each **stop** is a
 * row carrying the distance and the climb to it; the shaping points inside a leg are
 * ticks on the connector between two rows. A plan with fifteen hints and two real places
 * then reads as the trip it is, rather than as seventeen anonymous entries.
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
}) {
  /** Which stop is being dragged, as a POI ordinal. Transient, and never in the URL. */
  const [dragging, setDragging] = useState<number | null>(null)

  const totals = cumulative(legs)

  // Walked once: a row is a POI, and it needs both where it sits in the waypoint array
  // (every edit addresses that) and which leg arrives at it.
  let stop = -1
  const rows = plan.waypoints.map((waypoint, index) => {
    if (waypoint.kind === 'poi') stop += 1
    return { waypoint, index, stop }
  })

  return (
    <div className={styles.panel}>
      {error ? (
        <div className={styles.banner}>
          <strong>The router is not answering</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <PlaceSearch near={near} onPick={onPick} />

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

      {plan.waypoints.length === 0 ? (
        <div className={styles.empty}>
          <strong>Click the map to start</strong>
          <span>
            The first two points are the start and the end. After that you can add stops, or drag
            the line to shape the route.
          </span>
        </div>
      ) : (
        <div className={styles.group}>
          <Label>Route</Label>
          <ol className={styles.list}>
            {rows.map(({ waypoint, index, stop: ordinal }) => {
              const before = totals[ordinal - 1]

              return waypoint.kind === 'poi' ? (
                <li
                  key={index}
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
                  className={[styles.row, dragging === ordinal ? styles.rowDragging : ''].join(' ')}
                >
                  <button
                    type="button"
                    className={styles.rowButton}
                    onClick={() => onSelect(index)}
                  >
                    <span className={styles.dot} />
                    <span className={styles.name}>{waypoint.name ?? 'Unnamed stop'}</span>
                    {/* The first stop has nothing behind it, so it carries no numbers
                        rather than four zeroes. A leg that failed shows a dash: the
                        totals past it are short by that leg, and saying 12.4 km would
                        be quietly wrong. */}
                    {ordinal > 0 ? (
                      <span className={styles.meta}>
                        {before && !before.incomplete
                          ? `${km(before.distanceM)} km · ${metres(before.ascentM)} m up`
                          : '—'}
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
                <li key={index} className={styles.tick}>
                  <button
                    type="button"
                    className={styles.tickButton}
                    onClick={() => onSelect(index)}
                  >
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
