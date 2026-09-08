import type { LatLon, Leg, Place } from '@tracks/routing'
import { PROFILE_LABELS, PROFILES } from '@tracks/routing'
import { X } from 'lucide-react'
import { useState } from 'react'
import { km, metres } from '../lib/format.ts'
import type { Plan } from '../lib/plan.ts'
import { moveStop } from '../lib/plan-ops.ts'
import { readingsFrom } from '../lib/plan-track.ts'
import { PlaceSearch } from './PlaceSearch.tsx'
import { Label } from './ui/Label.tsx'
import styles from './WaypointPanel.module.css'

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
  /** Which stop the distances are measured from. Also a POI ordinal, also transient. */
  const [base, setBase] = useState<number | null>(null)

  const readings = readingsFrom(legs, base ?? 0)

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
          {/* Cleared on the way out of the list rather than per row: moving between
              rows crosses the gaps between them, and re-basing to the first stop for a
              frame each time would make the numbers flicker. */}
          <ol className={styles.list} onMouseLeave={() => setBase(null)}>
            {rows.map(({ waypoint, index, stop: ordinal }) => {
              const reading = readings[ordinal]

              return waypoint.kind === 'poi' ? (
                <li
                  key={index}
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
                  className={[styles.row, dragging === ordinal ? styles.rowDragging : ''].join(' ')}
                >
                  <button
                    type="button"
                    className={styles.rowButton}
                    // Focus re-bases too, so the list is not a mouse-only readout.
                    onFocus={() => setBase(ordinal)}
                    onClick={() => onSelect(index)}
                  >
                    <span className={styles.dot} />
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
