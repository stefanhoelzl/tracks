import type { ActivityTrack } from '@tracks/core'
import type { Leg } from '@tracks/routing'
import { PROFILE_LABELS } from '@tracks/routing'
import { useMemo } from 'react'
import { duration, km, metres } from '../lib/format.ts'
import type { Plan } from '../lib/plan.ts'
import { planTotals } from '../lib/plan-track.ts'
import { profileOf } from './ElevationProfile.tsx'
import styles from './PlanOverview.module.css'
import { TrackOverview } from './TrackOverview.tsx'

/**
 * The right panel while planning — where a selected activity's detail would be.
 *
 * The selection is shadowed rather than cleared: `activity=` stays in the query string
 * and this shows instead, so switching back restores the detail exactly as it was.
 *
 * It shares `TrackOverview` with that detail rather than resembling it. What a plan does
 * not have, it does not draw: no date, because it was never ridden, and no tags. The
 * engine and the profile sit where the source badge does, saying the same kind of thing
 * — where these numbers came from.
 */
export function PlanOverview({
  plan,
  legs,
  track,
  cursor,
  onCursor,
  onPlan,
}: {
  plan: Plan
  legs: Array<Leg | undefined>
  /** The legs end to end — the same array the map draws the cursor against. */
  track: ActivityTrack
  /** The point the elevation cursor is on, shared with the map exactly as a track's is. */
  cursor: number | null
  onCursor: (index: number | null) => void
  onPlan: (plan: Plan) => void
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
      </div>
    </>
  )
}
