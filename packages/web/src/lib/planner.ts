import type { LatLon, Place, Waypoint } from '@tracks/routing'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MapHandle } from '../components/MapView.tsx'
import type { PinTarget } from '../components/WaypointDialog.tsx'
import { message } from './api.ts'
import { type Plan, parsePlan } from './plan.ts'
import {
  addWaypoint,
  legLabel,
  nearestLeg,
  type Placement,
  placementAt,
  updateWaypoint,
} from './plan-ops.ts'
import { planBounds, planTrack } from './plan-track.ts'
import { type Reference, readReference, referenceBounds } from './references.ts'
import { geocoder, usePlanLegs } from './routing.ts'

/**
 * How long the pointer has to rest on a search result before the map goes there.
 *
 * Below noticing when you meant the row, and above the cost of sweeping past four on
 * the way to the fifth.
 */
const HOVER_DWELL_MS = 160

/**
 * Everything planning holds besides the plan itself.
 *
 * The plan is the URL's; what is here is what a plan is being made *with* — the routed
 * legs, the provisional pin, the search result under the pointer, the dropped files —
 * and the gestures that turn each of them into an edit. None of it needs an account,
 * which is the line this hook is drawn along: it is the half of the app a visitor who
 * never signed in is given whole.
 */
export function usePlanner({
  plan,
  setPlan,
  planning,
  mapHandle,
  setCursor,
}: {
  plan: Plan
  setPlan: (plan: Plan, mode?: 'push' | 'replace') => void
  planning: boolean
  mapHandle: RefObject<MapHandle | null>
  /** The elevation cursor is shared with an open activity, so its owner stays above this. */
  setCursor: (cursor: number | null) => void
}) {
  /**
   * The provisional pin, and what its dialog is about.
   *
   * Transient by the same rule as the rest of this block: it belongs to neither the plan
   * nor the URL. `at` is where it sits; the target says whether it is committing a new
   * waypoint or editing one that already exists.
   */
  const [pin, setPin] = useState<{ at: LatLon; target: PinTarget } | null>(null)
  /** The search result under the pointer, ringed on the map. Transient, like the pin. */
  const [preview, setPreview] = useState<LatLon | null>(null)
  const dwell = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /**
   * Dropped files, and the one still being read.
   *
   * In memory and nowhere else. A reference is the one thing here that is neither in
   * the URL nor on the server: a file's points are two orders of magnitude past what a
   * fragment can carry, and it is a thing you are looking at rather than making. A
   * reload asks for the file again, which is the stated cost.
   */
  const [references, setReferences] = useState<Reference[]>([])
  /** What is on screen, for the reader — which runs outside React's render. */
  const referencesLive = useRef<Reference[]>([])
  referencesLive.current = references
  const [reading, setReading] = useState<{ name: string; progress: number | null } | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  /** Which reference row is expanded to its profile. One at a time. */
  const [openReference, setOpenReference] = useState<string | null>(null)
  const readAbort = useRef<AbortController | null>(null)

  const { legs, pending: legsPending, error: legsError } = usePlanLegs(plan, planning)

  /**
   * Every routed leg as one track, computed here so the panel and the map read the same
   * array — which is what makes the elevation cursor one index rather than two roundings
   * of one position, exactly as it already is for an activity.
   */
  const planned = useMemo(() => planTrack(legs), [legs])

  /**
   * What *fit everything* means while planning.
   *
   * The extent of the activities is the wrong answer there — the plan is what you are
   * looking at, and the tracks behind it are context you dimmed on purpose.
   */
  const routeExtent = useMemo(() => {
    if (!planning) return null
    const plan_ = planBounds(plan.waypoints, legs)
    const files = referenceBounds(references)
    if (!plan_ || !files) return plan_ ?? files
    // Both, when both are there: while planning against somebody's route, *everything*
    // means the pair of them — framing only your own half hides what you are aiming at.
    return [
      Math.min(plan_[0], files[0]),
      Math.min(plan_[1], files[1]),
      Math.max(plan_[2], files[2]),
      Math.max(plan_[3], files[3]),
    ] as [number, number, number, number]
  }, [planning, plan.waypoints, legs, references])

  /**
   * Name a stop from whatever is there, after the fact.
   *
   * Lazily, and only for POIs — a shaping point wants no name, which is also exactly
   * what BRouter wants for one, so the gesture people repeat costs no request. The plan
   * is re-read from the URL rather than closed over: the lookup takes a moment, and the
   * address bar is the authority on what the plan is by the time it returns.
   */
  const nameStop = useCallback(
    async (at: LatLon, index: number) => {
      const name = await geocoder.reverse(at).catch(() => null)
      if (!name) return

      const current = parsePlan(window.location.hash)
      const waypoint = current.waypoints[index]
      if (waypoint?.kind !== 'poi' || waypoint.name !== null) return
      // Replace: the name is the tail of the click that added it, not a second edit.
      setPlan(updateWaypoint(current, index, { name }), 'replace')
    },
    [setPlan],
  )

  const addFromPin = useCallback(
    (kind: Waypoint['kind'], placement: Placement) => {
      if (pin?.target.state !== 'new') return

      const index = placementAt(plan, legs, placement, pin.target.leg, pin.at)
      const name = kind === 'poi' ? pin.target.name : null

      setPlan(addWaypoint(plan, { ...pin.at, kind, name }, index))
      setPin(null)
      if (kind === 'poi' && name === null) void nameStop(pin.at, index)
    },
    [pin, plan, legs, setPlan, nameStop],
  )

  /**
   * Adding a searched place straight from its row, without the pin in between.
   *
   * The placement is resolved here for the same reason `dropPin` resolves the leg here:
   * which leg is nearest is a question about the plan, and the search field has no
   * business knowing the answer.
   */
  const addPlace = useCallback(
    (place: Place, placement: Placement) => {
      const at = { lat: place.lat, lon: place.lon }
      const index = placementAt(plan, legs, placement, nearestLeg(plan, legs, at), at)
      setPlan(addWaypoint(plan, { ...at, kind: 'poi', name: place.name }, index))
      setPin(null)
      setPreview(null)
      // Every way of choosing a searched place ends up looking at it. A stop that
      // appeared somewhere off screen is a stop you have to go and find.
      mapHandle.current?.flyTo(at)
    },
    [plan, legs, setPlan, mapHandle],
  )

  /**
   * Ring the place under the pointer, and go and look at it.
   *
   * After a short dwell, not immediately: pointing at a row means *that one*, but
   * sweeping down five rows on the way to the fifth does not mean the first four, and a
   * camera that chased every one of them would be unreadable. A sixth of a second is
   * below noticing when you meant it and above the cost when you did not.
   */
  const previewPlace = useCallback(
    (place: Place | null) => {
      clearTimeout(dwell.current)
      setPreview(place ? { lat: place.lat, lon: place.lon } : null)
      if (!place) return

      const at = { lat: place.lat, lon: place.lon }
      dwell.current = setTimeout(() => mapHandle.current?.flyTo(at), HOVER_DWELL_MS)
    },
    [mapHandle],
  )

  useEffect(() => () => clearTimeout(dwell.current), [])

  /**
   * Reading dropped files, one after another.
   *
   * Serial rather than parallel: each one is a stream being decoded and parsed on this
   * thread, and three at once would interleave their chunks and make every one of them
   * slower. A file that fails costs itself and is named — the ones beside it still
   * load, which is M3.5's rule about a bad frame, unchanged.
   */
  const onDropFiles = useCallback(
    async (files: File[]) => {
      if (readAbort.current) readAbort.current.abort(new Error('superseded'))
      const controller = new AbortController()
      readAbort.current = controller

      const failures: string[] = []
      for (const file of files) {
        if (controller.signal.aborted) break
        setReading({ name: file.name, progress: null })
        try {
          // The slots already on screen, so two references never land on one colour —
          // read from the ref, because a file dropped beside this one has already added
          // its own since this loop started.
          const taken = new Set(referencesLive.current.map((reference) => reference.slot))
          const loaded = await readReference(file, taken, {
            signal: controller.signal,
            onProgress: (read, total) =>
              setReading({ name: file.name, progress: total === null ? null : read / total }),
          })
          setReferences((current) => {
            const next = [...current, ...loaded]
            referencesLive.current = next
            return next
          })
          // Framed as it lands, once — the rule the plan's own opening fit follows. A
          // file that drew three countries away would be reported as broken before
          // anything else about it.
          const bounds = referenceBounds(loaded)
          if (bounds) mapHandle.current?.fitBounds(bounds)
        } catch (error) {
          if (controller.signal.aborted) break
          failures.push(message(error) ?? `${file.name} could not be read`)
        }
      }

      if (readAbort.current === controller) {
        readAbort.current = null
        setReading(null)
      }
      setReadError(failures.length > 0 ? failures.join(' · ') : null)
    },
    [mapHandle],
  )

  /** Stops the file being read. One flag, checked between chunks. */
  const cancelRead = useCallback(() => {
    readAbort.current?.abort(new Error('cancelled'))
    readAbort.current = null
    setReading(null)
  }, [])

  const dismissReference = useCallback((id: string) => {
    setReferences((current) => current.filter((reference) => reference.id !== id))
    setOpenReference((current) => (current === id ? null : current))
  }, [])

  /**
   * The line the elevation cursor is about, when an open reference owns it.
   *
   * The cursor is one index and always has been; what changes here is which array it
   * indexes into. Opening a row hands that array to the map so the marker lands on the
   * reference rather than at the same offset along the plan.
   */
  const cursorTrack = useMemo(() => {
    const open = references.find((reference) => reference.id === openReference)
    return open ? open.points.map((point): [number, number] => [point.lon, point.lat]) : null
  }, [references, openReference])

  /** Opening a different line invalidates the cursor: it indexed into the old one. */
  const openReferenceRow = useCallback(
    (id: string | null) => {
      setCursor(null)
      setOpenReference(id)
    },
    [setCursor],
  )

  /**
   * Leaving planning takes the references with it, exactly as it takes the plan.
   *
   * The mode owns its transient state and destroys it on the way out — the rule that
   * means this app has no Clear button anywhere. Coming back is a fresh drop.
   */
  useEffect(() => {
    if (planning) return
    readAbort.current?.abort(new Error('left planning'))
    readAbort.current = null
    setReferences([])
    setReading(null)
    setReadError(null)
    setOpenReference(null)
  }, [planning])

  const editing = pin?.target.state === 'edit' ? pin.target.index : null

  const openWaypoint = useCallback(
    (index: number) => {
      const waypoint = plan.waypoints[index]
      if (waypoint) setPin({ at: waypoint, target: { state: 'edit', index, waypoint } })
    },
    [plan],
  )

  /**
   * A place, and the leg it is nearest — which is what makes *insert* and *shaping
   * point* offerable from a click anywhere rather than only from a click on the line.
   *
   * Except the first. An empty plan's only answer is *start here*, so it is added without
   * the dialog: a dialog with one button in it asks nothing. Named the way the dialog's
   * Add would have named it.
   */
  const dropPin = useCallback(
    (at: LatLon, name: string | null) => {
      if (plan.waypoints.length === 0) {
        setPlan(addWaypoint(plan, { ...at, kind: 'poi', name }, 0))
        setPin(null)
        if (name === null) void nameStop(at, 0)
        return
      }

      const leg = nearestLeg(plan, legs, at)
      setPin({
        at,
        target: { state: 'new', leg, between: leg === null ? null : legLabel(plan, leg), name },
      })
    },
    [plan, legs, setPlan, nameStop],
  )

  return {
    legs,
    legsPending,
    legsError,
    planned,
    routeExtent,
    pin,
    setPin,
    editing,
    preview,
    references,
    reading,
    readError,
    openReference,
    cursorTrack,
    addFromPin,
    addPlace,
    previewPlace,
    onDropFiles,
    cancelRead,
    dismissReference,
    openReferenceRow,
    openWaypoint,
    dropPin,
  }
}
