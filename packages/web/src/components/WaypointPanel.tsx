import { PROFILE_LABELS, PROFILES } from '@tracks/routing'
import type { Plan } from '../lib/plan.ts'
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
 * The profile lives here rather than on the map chrome: it belongs to the plan, travels
 * in the fragment with it, and changing it is a decision about the trip rather than
 * about the view.
 */
export function WaypointPanel({
  plan,
  pending,
  error,
  onPlan,
}: {
  plan: Plan
  /** A leg is in flight. The map has already drawn the beeline it will replace. */
  pending: boolean
  /** The engine refusing or unreachable — not a leg that could not be routed. */
  error: string | null
  onPlan: (plan: Plan) => void
}) {
  return (
    <div className={styles.panel}>
      {error ? (
        <div className={styles.banner}>
          <strong>The router is not answering</strong>
          <span>{error}</span>
        </div>
      ) : null}

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
      ) : null}

      {pending ? <div className={styles.pending}>Routing…</div> : null}
    </div>
  )
}
