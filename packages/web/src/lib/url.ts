import {
  emptyFilter,
  type Filter,
  formatSearch,
  parseFilter,
  parseView,
  type View,
} from '@tracks/core'
import { useCallback, useSyncExternalStore } from 'react'

/**
 * The URL is the state.
 *
 * No router: there is one page, its whole state is the query string, and core
 * already parses that. What is left is subscribing to `popstate` and writing back —
 * which `useSyncExternalStore` does in a dozen lines, without a dependency whose
 * main feature is routes this app does not have.
 */

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

function snapshot(): string {
  return window.location.search
}

/**
 * `replace` for anything continuous — dragging a slider, panning with the area
 * filter on — so Back steps out of the whole gesture rather than through every frame
 * of it. `push` for discrete choices, which is what makes Back mean "undo that".
 */
function write(search: string, mode: 'push' | 'replace'): void {
  const url = search === '' ? window.location.pathname : `${window.location.pathname}?${search}`
  if (mode === 'push') window.history.pushState(null, '', url)
  else window.history.replaceState(null, '', url)
  notify()
}

export interface UrlState {
  filter: Filter
  view: View
  /** Invalid when someone hand-edited the URL into something the grammar rejects. */
  error: string | null
  setFilter: (filter: Filter, mode?: 'push' | 'replace') => void
  setView: (view: View, mode?: 'push' | 'replace') => void
  reset: () => void
}

const EMPTY_VIEW: View = { colourBy: null, activity: null, grouped: true, basemap: 'map' }

export function useUrlState(): UrlState {
  const search = useSyncExternalStore(subscribe, snapshot, () => '')

  // Parsed on every render rather than memoised: it is a few dozen fields off a
  // string that only changes when the URL does, and a stale memo here would be a
  // filter that disagrees with the address bar.
  let filter = emptyFilter()
  let view = EMPTY_VIEW
  let error: string | null = null
  try {
    filter = parseFilter(search)
    view = parseView(search)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }

  const setFilter = useCallback((next: Filter, mode: 'push' | 'replace' = 'push') => {
    write(formatSearch(next, parseView(window.location.search)), mode)
  }, [])

  const setView = useCallback((next: View, mode: 'push' | 'replace' = 'push') => {
    write(formatSearch(parseFilter(window.location.search), next), mode)
  }, [])

  const reset = useCallback(() => {
    // Selection survives clearing the filters: you were looking at that activity for
    // a reason, and it is still there. So does the viewport — it is where you are
    // looking, not something you chose, and clearing filters should not move the map.
    const { bbox } = parseFilter(window.location.search)
    write(formatSearch({ ...emptyFilter(), bbox }, parseView(window.location.search)), 'push')
  }, [])

  return { filter, view, error, setFilter, setView, reset }
}
