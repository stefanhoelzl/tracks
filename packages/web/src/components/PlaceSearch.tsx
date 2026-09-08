import type { LatLon, Place } from '@tracks/routing'
import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Placement } from '../lib/plan-ops.ts'
import { geocoder } from '../lib/routing.ts'
import styles from './PlaceSearch.module.css'

/**
 * Finding a place by name.
 *
 * Pointing at a result rings it on the map, so *which Vent is that one* is answered by
 * looking rather than by committing to it. The row under the pointer also grows the
 * placements inline, because a searched place is almost always a stop and going through
 * the pinned dialog to say so is a step that decides nothing.
 *
 * Picking the row itself still raises that dialog, at that place, with the name already
 * known — which is the way to a shaping point, a rename, or a look before committing.
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
  placements,
  onPick,
  onAdd,
  onHover,
}: {
  /** Read at request time, not at render: the camera moves between keystrokes. */
  near: () => LatLon | null
  /** What adding here can mean, in the order the dialog offers it. */
  placements: Array<{ placement: Placement; label: string }>
  onPick: (place: Place) => void
  onAdd: (place: Place, placement: Placement) => void
  onHover: (place: Place | null) => void
}) {
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>([])
  const [hovered, setHovered] = useState<string | null>(null)
  const nearest = useRef(near)
  nearest.current = near
  const hover = useRef(onHover)
  hover.current = onHover

  // The ring belongs to a row that is on screen. Losing the results without clearing it
  // would leave a mark on the map pointing at nothing.
  useEffect(() => {
    if (places.length === 0) {
      setHovered(null)
      hover.current(null)
    }
  }, [places])

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
        <ul
          className={styles.results}
          onMouseLeave={() => {
            setHovered(null)
            onHover(null)
          }}
        >
          {places.map((place) => {
            const key = `${place.lat},${place.lon},${place.name}`
            const done = () => {
              // The list has answered the question it was asked; leaving it open would
              // offer four more places for a decision already made.
              setQuery('')
              setHovered(null)
              onHover(null)
            }

            return (
              <li
                key={key}
                className={styles.row}
                onMouseEnter={() => {
                  setHovered(key)
                  onHover(place)
                }}
              >
                <button
                  type="button"
                  className={styles.result}
                  onFocus={() => {
                    setHovered(key)
                    onHover(place)
                  }}
                  onClick={() => {
                    onPick(place)
                    done()
                  }}
                >
                  <span className={styles.name}>{place.name}</span>
                  {place.context ? <span className={styles.context}>{place.context}</span> : null}
                </button>

                {hovered === key ? (
                  <div className={styles.placements}>
                    {placements.map(({ placement, label }) => (
                      <button
                        key={placement}
                        type="button"
                        className={styles.add}
                        onClick={() => {
                          onAdd(place, placement)
                          done()
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
