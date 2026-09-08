import { PROFILE_LABELS } from '@tracks/routing'
import type { Plan } from '../lib/plan.ts'
import styles from './PlanOverview.module.css'

/**
 * The right panel while planning — where a selected activity's detail would be.
 *
 * A selected activity is shadowed rather than cleared: `activity=` stays in the query
 * string and this simply shows instead, so switching back restores the detail exactly
 * as it was.
 *
 * Below two waypoints there is no line and no totals, so it says that rather than
 * drawing a frame around nothing.
 */
export function PlanOverview({ plan }: { plan: Plan; onPlan: (plan: Plan) => void }) {
  const pois = plan.waypoints.filter((waypoint) => waypoint.kind === 'poi').length

  return (
    <>
      <div className={styles.header}>
        <div className={styles.spacer} />
        <span className={styles.engine}>{PROFILE_LABELS[plan.profile].toLowerCase()}</span>
      </div>

      <div className={styles.body}>
        {pois < 2 ? (
          <div className={styles.empty}>
            <strong>Nothing to route yet</strong>
            <span>
              Place a start and an end on the map, and the distance, the climb and the profile
              appear here.
            </span>
          </div>
        ) : null}
      </div>
    </>
  )
}
