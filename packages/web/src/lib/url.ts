import {
  emptyFilter,
  type Filter,
  formatSearch,
  parseFilter,
  parseView,
  type View,
} from '@tracks/core'
import { useCallback, useSyncExternalStore } from 'react'
import { emptyPlan, formatPlan, type Plan, parsePlan } from './plan.ts'

/**
 * The URL is the state.
 *
 * No router: there is one page, its whole state is the address, and core already parses
 * the query half of it. What is left is subscribing to the events that change it and
 * writing back — which `useSyncExternalStore` does in a dozen lines, without a
 * dependency whose main feature is routes this app does not have.
 *
 * Two slices since M8, and still one store. The query string carries the filter and the
 * view; the fragment carries the plan, because a fragment is never transmitted. The
 * snapshot is simply both, so a change to either wakes the same subscriber and there is
 * no second mechanism to keep in step with this one.
 */

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * `hashchange` as well as `popstate`.
 *
 * `pushState` fires neither, which is why `write` notifies by hand; `popstate` covers
 * Back and Forward; and `hashchange` covers the fragment being edited in the address
 * bar, which is the one way it can move without going through either. When two of them
 * fire for one change, `useSyncExternalStore` compares snapshots and the second is free.
 */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  window.addEventListener('hashchange', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
    window.removeEventListener('hashchange', listener)
  }
}

function snapshot(): string {
  return window.location.search + window.location.hash
}

/**
 * `replace` for anything continuous — dragging a slider, panning with the area
 * filter on, dragging a waypoint — so Back steps out of the whole gesture rather than
 * through every frame of it. `push` for discrete choices, which is what makes Back mean
 * "undo that", and is why the plan needs no undo stack of its own.
 */
function write(search: string, hash: string, mode: 'push' | 'replace'): void {
  const url = `${window.location.pathname}${search === '' ? '' : `?${search}`}${
    hash === '' ? '' : `#${hash}`
  }`
  if (mode === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
  notify()
}

export interface UrlState {
  filter: Filter
  view: View
  plan: Plan
  /** Invalid when someone hand-edited the URL into something the grammar rejects. */
  error: string | null
  setFilter: (filter: Filter, mode?: 'push' | 'replace') => void
  setView: (view: View, mode?: 'push' | 'replace') => void
  setPlan: (plan: Plan, mode?: 'push' | 'replace') => void
  reset: () => void
}

const EMPTY_VIEW: View = {
  colourBy: null,
  activity: null,
  grouped: true,
  basemap: 'map',
  mode: 'activities',
  bucket: 'month',
  metric: 'distance',
  calendar: null,
  calendarColour: 'ramp',
}

/** The fragment as it stands, without its `#`. */
function currentHash(): string {
  return window.location.hash.replace(/^#/, '')
}

export function useUrlState(): UrlState {
  const href = useSyncExternalStore(subscribe, snapshot, () => '')

  // Split back apart rather than read `location` again, so what is parsed is exactly
  // what the store observed. A `#` inside the query string is always percent-encoded,
  // so the first one is the boundary.
  const cut = href.indexOf('#')
  const search = cut === -1 ? href : href.slice(0, cut)
  const hash = cut === -1 ? '' : href.slice(cut + 1)

  // Parsed on every render rather than memoised: it is a few dozen fields off a
  // string that only changes when the URL does, and a stale memo here would be a
  // filter that disagrees with the address bar.
  let filter = emptyFilter()
  let view = EMPTY_VIEW
  let plan = emptyPlan()
  let error: string | null = null
  try {
    filter = parseFilter(search)
    view = parseView(search)
    plan = parsePlan(hash)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  const setFilter = useCallback((next: Filter, mode: 'push' | 'replace' = 'push') => {
    write(formatSearch(next, parseView(window.location.search)), currentHash(), mode)
  }, [])

  /**
   * Changing the mode is also how a plan is cleared.
   *
   * `#plan` exists only while `mode=planning`, so leaving planning drops it — which is
   * why there is no Clear control anywhere, and why starting a fresh plan is switching
   * away and back. It lives here rather than in a caller because this is the one
   * function that can change the mode, so nothing is able to forget.
   */
  const setView = useCallback((next: View, mode: 'push' | 'replace' = 'push') => {
    const hash = next.mode === 'planning' ? currentHash() : ''
    write(formatSearch(parseFilter(window.location.search), next), hash, mode)
  }, [])

  const setPlan = useCallback((next: Plan, mode: 'push' | 'replace' = 'push') => {
    write(window.location.search.replace(/^\?/, ''), formatPlan(next), mode)
  }, [])

  const reset = useCallback(() => {
    // Selection survives clearing the filters: you were looking at that activity for
    // a reason, and it is still there. So does the viewport — it is where you are
    // looking, not something you chose, and clearing filters should not move the map.
    // So does the plan: it is not a filter, and losing an hour of planning to a button
    // labelled *clear filters* would be this app's worst moment.
    const { bbox } = parseFilter(window.location.search)
    write(
      formatSearch({ ...emptyFilter(), bbox }, parseView(window.location.search)),
      currentHash(),
      'push',
    )
  }, [])

  return { filter, view, plan, error, setFilter, setView, setPlan, reset }
}
