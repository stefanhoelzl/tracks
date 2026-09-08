import type { LatLon, Place } from '@tracks/routing'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { geocoder } from '../lib/routing.ts'
import styles from './PlaceSearch.module.css'

/**
 * Finding a place by name.
 *
 * Picking a result does not add anything: it raises the same pinned dialog a map click
 * raises, at that place, with the name already known. One commit path however the place
 * was found — and the name travels with it, so a searched stop never needs a reverse
 * lookup.
 *
 * Biased to the map centre rather than bounded by it, which decides the case that
 * actually comes up: Vent exists in four countries and you are usually looking straight
 * at the one you mean. A bounding box would instead make the far end of a tour you have
 * not panned to unfindable.
 */

/** Long enough that a fast typist sends one request, short enough to feel immediate. */
const DEBOUNCE_MS = 250

export function PlaceSearch({
  near,
  onPick,
}: {
  /** Read at request time, not at render: the camera moves between keystrokes. */
  near: () => LatLon | null
  onPick: (place: Place) => void
}) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const nearest = useRef(near)
  nearest.current = near

  useEffect(() => {
    if (query.trim() === '') {
      setPlaces([])
      return
    }

    // One request per pause, and the one in flight is abandoned the moment another
    // keystroke supersedes it — the `AbortSignal` the interface already takes.
    const controller = new AbortController()
    const timer = setTimeout(() => {
      geocoder
        .search(query, nearest.current(), controller.signal)
        .then(setPlaces)
        .catch(() => {
          // An aborted search is the expected outcome of typing, not a failure, and a
          // geocoder that is down is already an empty list.
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  return (
    <div className={styles.search}>
      <div className={styles.field}>
        <Search size={14} strokeWidth={2} className={styles.icon} />
        <input
          className={styles.input}
          type="search"
          value={query}
          placeholder="Search for a place"
          aria-label="Search for a place"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>

      {places.length > 0 ? (
        <ul className={styles.results}>
          {places.map((place) => (
            <li key={`${place.lat},${place.lon},${place.name}`}>
              <button
                type="button"
                className={styles.result}
                onClick={() => {
                  onPick(place)
                  // The pin is now carrying the query; leaving the list open under it
                  // would offer four more places for a decision already made.
                  setQuery('')
                }}
              >
                <span className={styles.name}>{place.name}</span>
                {place.context ? <span className={styles.context}>{place.context}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
