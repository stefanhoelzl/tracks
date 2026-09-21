import { CONTOUR_OVERLAYS } from './contours.ts'
import { TRACK_OVERLAYS } from './layers.ts'
import { concat, type Overlays } from './overlay-spec.ts'
import { PLAN_OVERLAYS } from './plan-layers.ts'
import { REFERENCE_OVERLAYS } from './reference-overlays.ts'

/**
 * Every overlay the web and the phone draw, in one list — see `overlay-spec.ts` for the format.
 *
 * Its order is the stack: contours over the basemap, the ridden tracks, files dropped in, and the
 * plan on top, with what is being said about it — the picked-out stretch, the cursor — over that.
 */
export const OVERLAYS: Overlays = concat(
  CONTOUR_OVERLAYS,
  TRACK_OVERLAYS,
  REFERENCE_OVERLAYS,
  PLAN_OVERLAYS,
)

/** What `overlays.json` holds: the whole list, tags and all, for the phone to take its part of. */
export function overlaysDocument(): string {
  return `${JSON.stringify(OVERLAYS, null, 1)}\n`
}
