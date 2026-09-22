import { formatView, parseFilter, type View } from '@tracks/core'
import { activeTerms } from './filter-ops.ts'
import { RANGE_UNITS } from './format.ts'
import { formatPlan, type Plan } from './plan.ts'

/**
 * Share links, as the browser spells them.
 *
 * Pure, like `filter-ops.ts`: which page a path is, what URL a link is copied as, and
 * what a link without a label is called in your own list.
 */

/**
 * The token in `/share/<token>`, or null for every other path.
 *
 * The one piece of routing the app has. Everything else it shows is the root page with
 * a different query string; a link is a different *page* — nobody signed in, reads from
 * a different prefix — and the path is what says so before anything is fetched.
 */
export function shareTokenOf(pathname: string): string | null {
  const match = /^\/share\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)
  return match ? match[1]! : null
}

/**
 * The URL to hand out: the link, and how you were looking at it.
 *
 * Only the filter lives in the row. The view rides in the query string, so the link
 * opens in Analytics if that is where you were — and the viewer can change it, because
 * it is theirs from then on. Two parts of the view do not travel: colouring by a tag
 * type, since a link carries no tags to colour by; and Planning, which a link does not
 * offer. The open activity is not view state at all — it is in the filter, and
 * `shareFilterOf` leaves it out.
 */
export function shareUrl(origin: string, token: string, view: View): string {
  const params = formatView({
    ...view,
    colourBy: null,
    calendarColour: 'ramp',
    mode: view.mode === 'planning' ? 'activities' : view.mode,
  }).toString()
  return `${origin}/share/${token}${params === '' ? '' : `?${params}`}`
}

/**
 * The URL a plan is shared as: the planner at the root, and the plan in the fragment.
 *
 * No token and no filter. A plan is not anybody's rows — the planner needs no account —
 * so whoever opens it gets the plan, over their own tracks if they have any. Which is also
 * why a viewer planning over somebody's link hands out this rather than the link.
 */
export function planUrl(origin: string, plan: Plan): string {
  return `${origin}/?mode=planning#${formatPlan(plan)}`
}

/**
 * What an unlabelled link is called in your own list — its filter, in the words the
 * chips use. `labels` maps tag types to their names, as the sidebar has them.
 */
export function describeShare(stored: string, labels: Map<string, string>): string {
  const terms = activeTerms(parseFilter(stored), labels, RANGE_UNITS)
  if (terms.length === 0) return 'Everything'
  return terms
    .map((term) => `${term.negated ? 'not ' : ''}${term.facet.toLowerCase()} ${term.value}`)
    .join(' · ')
}
