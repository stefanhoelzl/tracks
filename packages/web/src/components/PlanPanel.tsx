import type { ActivityTrack } from '@tracks/core'
import type { LatLon, Leg, Place } from '@tracks/routing'
import { PROFILE_LABELS } from '@tracks/routing'
import { useMemo } from 'react'
import { duration, km, metres } from '../lib/format.ts'
import type { Plan } from '../lib/plan.ts'
import { derivedName, type Placement } from '../lib/plan-ops.ts'
import { planTotals } from '../lib/plan-track.ts'
import type { Reference } from '../lib/references.ts'
import { profileOf } from './ElevationProfile.tsx'
import styles from './PlanPanel.module.css'
import { ReferenceList } from './ReferenceList.tsx'
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
  references,
  openReference,
  reading,
  referenceError,
  onOpenReference,
  onDismissReference,
  onCancelRead,
  onCursor,
  onPlan,
  onSelect,
  onRemove,
  onPick,
  onAddPlace,
  onHoverPlace,
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
  /** Dropped files, drawn on the map and listed here. */
  references: readonly Reference[]
  /** Which reference row is expanded to its profile. One at a time. */
  openReference: string | null
  reading: { name: string; progress: number | null } | null
  referenceError: string | null
  onOpenReference: (id: string | null) => void
  onDismissReference: (id: string) => void
  onCancelRead: () => void
  onCursor: (index: number | null) => void
  onPlan: (plan: Plan) => void
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  onPick: (place: Place) => void
  onAddPlace: (place: Place, placement: Placement) => void
  onHoverPlace: (place: Place | null) => void
}) {
  const stops = plan.waypoints.filter((waypoint) => waypoint.kind === 'poi')

  const totals = useMemo(() => planTotals(legs), [legs])
  // Walks every routed point, so it is measured once per set of legs rather than on
  // every hover — the same reason the activity detail memoises its own.
  const profile = useMemo(
    () => profileOf(track, totals.distanceM > 0 ? totals.distanceM : null),
    [track, totals.distanceM],
  )

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
              appear here. Or drop a GPX on the map to plan against somebody else's route — it is
              drawn over your rides and never leaves the tab.
            </span>
          </div>
        ) : (
          <TrackOverview
            title={
              <input
                className={styles.name}
                value={plan.name}
                // What the plan is when nobody has named it — and what the tab title
                // falls back to, which is why it is not computed here.
                placeholder={derivedName(plan)}
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

        {/* Between the plan's numbers and the controls that change it: a reference is
            neither an output of the plan nor an input to it, and it is what you look at
            while deciding where the next stop goes. */}
        <ReferenceList
          references={references}
          open={openReference}
          cursor={cursor}
          reading={reading}
          error={referenceError}
          onOpen={onOpenReference}
          onCursor={onCursor}
          onDismiss={onDismissReference}
          onCancel={onCancelRead}
        />

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
          onAddPlace={onAddPlace}
          onHoverPlace={onHoverPlace}
        />
      </div>
    </>
  )
}
