import type { ActivityRow, Mode } from '@tracks/core'
import { useEffect } from 'react'
import type { Plan } from './plan.ts'
import { derivedName } from './plan-ops.ts'

/**
 * What the tab says.
 *
 * A ladder rather than a summary: the narrowest true thing takes the front, and the
 * brand closes it. The filter is deliberately not in it — panning, tagging, searching
 * and picking dates all change what is on screen without changing what you are *looking
 * at*, and a tab that rewrote itself on every pan would be noise in the tab strip. So
 * the whole vocabulary is an activity, a plan, `Analytics`, and `Tracks`.
 *
 * Pure, the way `filter-ops.ts` and `plan-ops.ts` are pure, so every rung of the ladder
 * is testable without rendering anything. The caller flattens react-query's shape into
 * `activity` and `pending`; nothing about how the name is fetched reaches in here.
 */

const BRAND = 'Tracks'

/** The same middot the top bar and the chips separate with. */
const SEP = ' · '

export interface TitleState {
  mode: Mode
  plan: Plan
  /** The open activity once it is known — null when none is selected, or the fetch failed. */
  activity: ActivityRow | null
  /** One is selected and its name has not arrived yet. */
  pending: boolean
}

/**
 * The specific half of the title, or `''` when there is nothing specific to say.
 *
 * A non-default mode outranks a selected activity: the selection survives a mode switch
 * on purpose, but Planning and Analytics are the surface you deliberately went to, and
 * in planning the detail panel is not even on screen.
 */
export function titleOf({ mode, plan, activity, pending }: TitleState): string {
  if (mode === 'planning') {
    // A plan you have not named is still a plan you can recognise, and the panel is
    // already showing you these two ends in the name field's placeholder.
    const name = plan.name || derivedName(plan)
    return name === '' ? 'Planning' : `${name}${SEP}Planning`
  }

  if (mode === 'analytics') return 'Analytics'

  // Said rather than left stale: a cold link knows the id long before the name, and
  // the right panel is saying *Loading track…* in the same gap. A fetch that fails
  // leaves neither — which falls through to the brand alone, since nothing specific
  // is on screen and the panel carries the error where it can be read.
  if (pending) return 'Loading…'
  if (activity) return activity.title ?? 'Untitled'

  return ''
}

/**
 * Set the tab title, brand and all.
 *
 * The brand lives here rather than in `titleOf` so exactly one place knows what the app
 * is called — `SignIn` renders above `App` and needs a title too, and it passes only its
 * own half of one.
 */
export function useDocumentTitle(part: string): void {
  useEffect(() => {
    document.title = part === '' ? BRAND : `${part}${SEP}${BRAND}`
  }, [part])
}
