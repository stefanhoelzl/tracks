import { useSyncExternalStore } from 'react'

/**
 * Which of the three layouts the window is wide enough for.
 *
 * - `wide`: both panels beside the map, as the app has always been.
 * - `narrow`: the same panels, one open at a time — two would leave no map between them.
 * - `phone`: one sheet over a full-bleed map, and read-only.
 *
 * Width decides alone, and this is the only place that asks. Read-only follows the layout
 * rather than the device, so a desktop window made narrow is read-only too; gestures are the
 * exception and follow the input of each event, which is not a question for this hook.
 */
export type Layout = 'phone' | 'narrow' | 'wide'

/** Below this the phone layout. The CSS writes the same number out as `899px`. */
export const PHONE_MAX = 899
/** Below this the desktop keeps one panel open at a time: `1099px` in the CSS. */
export const NARROW_MAX = 1099

const PHONE = `(max-width: ${PHONE_MAX}px)`
const NARROW = `(max-width: ${NARROW_MAX}px)`

function snapshot(): Layout {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide'
  if (window.matchMedia(PHONE).matches) return 'phone'
  if (window.matchMedia(NARROW).matches) return 'narrow'
  return 'wide'
}

function subscribe(notify: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const queries = [window.matchMedia(PHONE), window.matchMedia(NARROW)]
  for (const query of queries) query.addEventListener('change', notify)
  return () => {
    for (const query of queries) query.removeEventListener('change', notify)
  }
}

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, snapshot, () => 'wide')
}
