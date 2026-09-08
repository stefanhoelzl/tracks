import type { ActivityTrack } from '@tracks/core'
import type { LatLon, Leg, Place } from '@tracks/routing'
import { PROFILE_LABELS } from '@tracks/routing'
import { useMemo } from 'react'
import { duration, km, metres } from '../lib/format.ts'
import type { Plan } from '../lib/plan.ts'
import { planTotals } from '../lib/plan-track.ts'
import { profileOf } from './ElevationProfile.tsx'
import styles from './PlanPanel.module.css'
import { TrackOverview } from './TrackOverview.tsx'
import { WaypointPanel } from './WaypointPanel.tsx'

/**
 * The whole plan, in the panel a selected activity's detail would be in.
 *
 * **Only the right side changes with the mode.** The left panel is the filter in every
 * mode, which keeps the sidebar exactly where it was and keeps it doing something while
 * you plan — the tracks underneath are still narrowed by it, and planning against what
 * you have already ridden is most of the reason to plan on this map. So the plan's
 * numbers and the controls that change them are stacked here instead, in one scroll.
 *
 * Its top half shares `TrackOverview` with the activity detail rather than resembling
 * it. What a plan does not have, it does not draw: no date, because it was never ridden,
 * and no tags. The engine and the profile sit where the source badge does, saying the
 * same kind of thing — where these numbers came from.
 *
 * Outputs above, inputs below, which is the order the activity detail already uses: what
 * this is, then the collection you edit.
 */
export function PlanPanel({
  plan,
  legs,
  track,
  cursor,
  pending,
  error,
  near,
  onCursor,
  onPlan,
  onSelect,
  onRemove,
  onPick,
}: {
  plan: Plan
  legs: Array<Leg | undefined>
  /** The legs end to end — the same array the map draws the cursor against. */
  track: ActivityTrack
  /** The point the elevation cursor is on, shared with the map exactly as a track's is. */
  cursor: number | null
  pending: boolean
  error: string | null
  near: () => LatLon | null
  onCursor: (index: number | null) => void
  onPlan: (plan: Plan) => void
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  onPick: (place: Place) => void
}) {
  const stops = plan.waypoints.filter((waypoint) => waypoint.kind === 'poi')

  const totals = useMemo(() => planTotals(legs), [legs])
  // Walks every routed point, so it is measured once per set of legs rather than on
  // every hover — the same reason the activity detail memoises its own.
  const profile = useMemo(
    () => profileOf(track, totals.distanceM > 0 ? totals.distanceM : null),
    [track, totals.distanceM],
  )

  /** What the plan is, when nobody has named it. Always current, and never in the URL. */
  const derived =
    stops.length >= 2
      ? `${stops[0]?.name ?? 'Start'} → ${stops[stops.length - 1]?.name ?? 'End'}`
      : ''

  return (
    <>
      <div className={styles.header}>
        <div className={styles.spacer} />
        <span className={styles.engine}>
          brouter · {PROFILE_LABELS[plan.profile].toLowerCase()}
        </span>
      </div>

      <div className={styles.body}>
        {stops.length < 2 ? (
          <div className={styles.empty}>
            <strong>Nothing to route yet</strong>
            <span>
              Place a start and an end on the map, and the distance, the climb and the profile
              appear here.
            </span>
          </div>
        ) : (
          <TrackOverview
            title={
              <input
                className={styles.name}
                value={plan.name}
                placeholder={derived}
                aria-label="Plan name"
                onChange={(event) => onPlan({ ...plan, name: event.currentTarget.value })}
              />
            }
            when={`${stops.length} stops · ${legs.length} ${legs.length === 1 ? 'leg' : 'legs'}`}
            tiles={[
              { label: 'Distance', value: km(totals.distanceM), unit: 'km' },
              { label: 'Ascent', value: metres(totals.ascentM), unit: 'm' },
              { label: 'Descent', value: metres(totals.descentM), unit: 'm' },
              { label: 'Est. time', value: duration(totals.durationS), unit: 'h' },
            ]}
            profile={profile}
            cursor={cursor}
            onCursor={onCursor}
            note={
              totals.incomplete
                ? 'One leg could not be routed, so these totals are short by it.'
                : null
            }
          />
        )}

        <WaypointPanel
          plan={plan}
          legs={legs}
          pending={pending}
          error={error}
          near={near}
          onPlan={onPlan}
          onSelect={onSelect}
          onRemove={onRemove}
          onPick={onPick}
        />
      </div>
    </>
  )
}
