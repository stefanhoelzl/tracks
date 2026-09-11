import { useQueryClient } from '@tanstack/react-query'
import type { NewType, SortKey, TagWrite } from '@tracks/core'
import type { LatLon, Place, Waypoint } from '@tracks/routing'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import { ActivityList } from './components/ActivityList.tsx'
import { AnalyticsPanel } from './components/AnalyticsPanel.tsx'
import { DetailPanel } from './components/DetailPanel.tsx'
import { FilterSidebar } from './components/FilterSidebar.tsx'
import { ImportDialog, type ImportSource } from './components/ImportDialog.tsx'
import { MapChrome } from './components/MapChrome.tsx'
import { type MapHandle, MapView } from './components/MapView.tsx'
import { PlanPanel } from './components/PlanPanel.tsx'
import { TopBar } from './components/TopBar.tsx'
import { IconButton } from './components/ui/IconButton.tsx'
import { Panel } from './components/ui/Panel.tsx'
import { type PinTarget, WaypointDialog } from './components/WaypointDialog.tsx'
import {
  ApiFailure,
  useActivities,
  useActivityDetail,
  useActivityTags,
  useFacets,
  useTagTypes,
  useTagWrite,
  useTracks,
} from './lib/api.ts'
import { buildScale, type ColourGroup, TYPE_GROUP } from './lib/colour.ts'
import { setBbox } from './lib/filter-ops.ts'
import { parsePlan } from './lib/plan.ts'
import {
  addWaypoint,
  kindIsAChoice,
  legLabel,
  moveWaypoint,
  nearestLeg,
  type Placement,
  placementAt,
  removeWaypoint,
  setKind,
  updateWaypoint,
} from './lib/plan-ops.ts'
import { planBounds, planTrack } from './lib/plan-track.ts'
import { type Reference, readReference } from './lib/references.ts'
import { geocoder, usePlanLegs } from './lib/routing.ts'
import { useSignOut } from './lib/session.ts'
import { titleOf, useDocumentTitle } from './lib/title.ts'
import { useUrlState } from './lib/url.ts'

/**
 * How long the pointer has to rest on a search result before the map goes there.
 *
 * Below noticing when you meant the row, and above the cost of sweeping past four on
 * the way to the fifth.
 */
const HOVER_DWELL_MS = 160

/** Kept in step with the token file, which the map needs as numbers for its padding. */
const PANEL_W = 300
const LIST_W = 356
const RAIL_W = 44

function message(error: unknown): string | null {
  if (!error) return null
  if (error instanceof ApiFailure) return error.message
  return error instanceof Error ? error.message : String(error)
}

export function App({ email }: { email: string }) {
  const { filter, view, plan, error: urlError, setFilter, setView, setPlan, reset } = useUrlState()

  /**
   * Planning shadows the other modes rather than replacing their state. The filter is
   * still filtering the tracks underneath — and still on screen, since only the right
   * panel follows the mode — and `activity=` is left exactly as it was. Only the plan
   * is destroyed by leaving, and `setView` is where that happens.
   */
  const planning = view.mode === 'planning'
  const signOut = useSignOut()

  // Transient by design: which panels are folded and what the pointer is over say
  // nothing about what you are looking at, so they have no business in a bookmark.
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [listOpen, setListOpen] = useState(true)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [importing, setImporting] = useState<ImportSource | null>(null)
  // Which point of the selected track the elevation cursor is on. It is one number
  // whichever end moved — the profile sets it on hover, the map sets it on hover, and
  // both read it back — so the two can never disagree about which point is meant.
  const [cursor, setCursor] = useState<number | null>(null)
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

  const queryClient = useQueryClient()

  const mapHandle = useRef<MapHandle>(null)

  const tagTypes = useTagTypes()
  const activities = useActivities(filter)
  const tracks = useTracks(filter)
  const facets = useFacets(filter)
  const detail = useActivityDetail(view.activity)

  const tagWrite = useTagWrite(filter)
  const activityTags = useActivityTags(view.activity)

  /**
   * The tab says what you are looking at.
   *
   * react-query's shape is flattened here rather than inside `titleOf`, so the ladder
   * stays a statement about the app's state and knows nothing about fetching. `detail`
   * is pending whenever it is disabled, which is why the selection is asked about
   * first — an empty list would otherwise load forever in the tab strip.
   */
  useDocumentTitle(
    titleOf({
      mode: view.mode,
      plan,
      activity: detail.data?.activity ?? null,
      pending: view.activity !== null && detail.isPending,
    }),
  )

  /**
   * What the last bulk write did, until the next action.
   *
   * The rows it touched usually stop matching the moment it lands — tagging everything
   * under *not set* empties the list by definition — so this line is what is left to
   * say it happened. That the pile went down is the other half, and the better half.
   */
  const [writeResult, setWriteResult] = useState<string | null>(null)

  const onWrite = useCallback(
    async (write: TagWrite) => {
      const { changed } = await tagWrite.mutateAsync(write)
      const tag = write.add[0] ?? write.remove[0] ?? ''
      const verb = write.add.length > 0 ? 'tagged' : 'untagged'
      setWriteResult(`${changed} ${changed === 1 ? 'activity' : 'activities'} ${verb} · ${tag}`)
    },
    [tagWrite],
  )

  const onActivityTags = useCallback(
    (tags: string[], newType?: NewType) => activityTags.mutateAsync({ tags, newType }),
    [activityTags],
  )

  /**
   * Colour by the registry's first type unless the URL says otherwise.
   *
   * The default stays out of the URL — writing it would mean every link carried a
   * choice nobody made — so it is resolved here, where the registry is known.
   */
  const colourBy = view.colourBy ?? tagTypes.data?.tagTypes[0]?.name ?? null

  /**
   * The colour layout, rebuilt only when the value sets change.
   *
   * Values come from the registry response, which counts them over every activity
   * rather than over the filter — so panning the map or picking a date cannot re-lay
   * out the sports underneath you. The type names are laid out too, for the swatch a
   * sidebar group wears. Years come from the tracks themselves, since nothing else
   * enumerates them.
   */
  const scale = useMemo(() => {
    const types = tagTypes.data?.tagTypes ?? []
    const groups: ColourGroup[] = types.map((type) => ({
      type: type.name,
      values: type.values.map((v) => v.value),
    }))
    groups.push({ type: TYPE_GROUP, values: types.map((type) => type.name) })

    const years = new Set<string>()
    for (const feature of tracks.data?.features ?? []) years.add(String(feature.properties.year))
    groups.push({ type: 'year', values: [...years] })

    return buildScale(groups)
  }, [tagTypes.data, tracks.data])

  const insets = {
    left: (filtersOpen ? PANEL_W : RAIL_W) + 16,
    right: (listOpen ? LIST_W : RAIL_W) + 16,
  }

  const onViewportChange = useCallback(
    (bbox: [number, number, number, number]) => {
      // Replace: panning is continuous, and Back should leave the area filter rather
      // than retrace every frame of the pan.
      setFilter(setBbox(filter, bbox), 'replace')
    },
    [filter, setFilter],
  )

  const zoom = useCallback((delta: number) => mapHandle.current?.zoomBy(delta), [])

  // --- Planning -------------------------------------------------------------

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
  const routeExtent = useMemo(
    () => (planning ? planBounds(plan.waypoints, legs) : null),
    [planning, plan.waypoints, legs],
  )

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
    [plan, legs, setPlan],
  )

  /**
   * Ring the place under the pointer, and go and look at it.
   *
   * After a short dwell, not immediately: pointing at a row means *that one*, but
   * sweeping down five rows on the way to the fifth does not mean the first four, and a
   * camera that chased every one of them would be unreadable. A sixth of a second is
   * below noticing when you meant it and above the cost when you did not.
   */
  const previewPlace = useCallback((place: Place | null) => {
    clearTimeout(dwell.current)
    setPreview(place ? { lat: place.lat, lon: place.lon } : null)
    if (!place) return

    const at = { lat: place.lat, lon: place.lon }
    dwell.current = setTimeout(() => mapHandle.current?.flyTo(at), HOVER_DWELL_MS)
  }, [])

  useEffect(() => () => clearTimeout(dwell.current), [])

  /**
   * Reading dropped files, one after another.
   *
   * Serial rather than parallel: each one is a stream being decoded and parsed on this
   * thread, and three at once would interleave their chunks and make every one of them
   * slower. A file that fails costs itself and is named — the ones beside it still
   * load, which is M3.5's rule about a bad frame, unchanged.
   */
  const onDropFiles = useCallback(async (files: File[]) => {
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
  }, [])

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
  const openReferenceRow = useCallback((id: string | null) => {
    setCursor(null)
    setOpenReference(id)
  }, [])

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
   */
  const dropPin = useCallback(
    (at: LatLon, name: string | null) => {
      const leg = nearestLeg(plan, legs, at)
      setPin({
        at,
        target: { state: 'new', leg, between: leg === null ? null : legLabel(plan, leg), name },
      })
    },
    [plan, legs],
  )

  /**
   * Selecting is also the one thing that invalidates the cursor: it indexes into the
   * track that was open, and the next one is a different array of a different length.
   */
  const select = useCallback(
    (id: number | null) => {
      setCursor(null)
      setView({ ...view, activity: id })
    },
    [view, setView],
  )

  /**
   * An import landed, so everything on screen is stale: the rows, the geometry, the
   * counts and histogram bounds, and the registry itself — an import can create a type
   * and certainly creates values. All four caches go.
   *
   * The filter goes with them. New activities arriving behind an active filter would
   * be imported and invisible in the same breath — and the viewport is part of the
   * filter, so "behind" includes "somewhere else on the map".
   */
  const onImported = useCallback(() => {
    queryClient.invalidateQueries()
    reset()
  }, [queryClient, reset])

  /**
   * Where everything matching the non-spatial filters is, so the camera can go there.
   *
   * Null while a request is in flight: react-query keeps the previous response as
   * placeholder data, and framing the *old* filter's extent for the new one would fly
   * the camera somewhere it was never asked to go.
   */
  const extent = facets.isPlaceholderData ? null : (facets.data?.extent ?? null)

  const listError = message(activities.error) ?? message(tracks.error) ?? urlError

  return (
    <div className={styles.app}>
      <MapView
        ref={mapHandle}
        tracks={tracks.data}
        detail={detail.data}
        colourBy={colourBy}
        scale={scale}
        grouped={view.grouped}
        basemap={view.basemap}
        filter={filter}
        extent={extent}
        hoveredId={hoveredId}
        selectedId={view.activity}
        cursor={cursor}
        panelInsets={insets}
        onHover={setHoveredId}
        onCursor={setCursor}
        onSelect={(id) => select(id)}
        onViewportChange={onViewportChange}
        planning={planning}
        plan={plan}
        legs={legs}
        plannedTrack={planned.coordinates}
        references={references}
        cursorTrack={cursorTrack}
        pending={legsPending}
        preview={preview}
        pinAt={pin?.at ?? null}
        pin={
          pin ? (
            <WaypointDialog
              target={pin.target}
              count={plan.waypoints.length}
              kindIsAChoice={kindIsAChoice(plan)}
              onAdd={addFromPin}
              onKind={(kind) => {
                if (editing !== null) setPlan(setKind(plan, editing, kind))
                setPin(null)
              }}
              onRename={(name) => {
                if (editing !== null) setPlan(updateWaypoint(plan, editing, { name: name || null }))
              }}
              onRemove={() => {
                if (editing !== null) setPlan(removeWaypoint(plan, editing))
                setPin(null)
              }}
              onClose={() => setPin(null)}
            />
          ) : null
        }
        onMapClick={(at) => dropPin(at, null)}
        onWaypointClick={openWaypoint}
        // Replace on both: a drag is one gesture, and Back should step out of it rather
        // than through every frame.
        onWaypointMove={(index, at) => {
          setPin(null)
          setPlan(moveWaypoint(plan, index, at), 'replace')
        }}
        onShapingDrop={(index, at) => {
          setPin(null)
          setPlan(addWaypoint(plan, { ...at, kind: 'routing', name: null }, index), 'replace')
        }}
        // A file's mark raises the dialog a map click raises, with the name already
        // known — so adopting somebody's hut needs no reverse lookup and no typing.
        onReferenceWaypoint={(at, name) => dropPin(at, name)}
        onDropFiles={onDropFiles}
      />

      <div className={styles.top} style={{ left: 16, right: 16 }}>
        <TopBar
          summary={facets.data?.summary}
          filter={filter}
          tagTypes={tagTypes.data?.tagTypes ?? []}
          scale={scale}
          mode={view.mode}
          email={email}
          onChange={setFilter}
          onClear={reset}
          onImport={setImporting}
          onMode={(mode) => setView({ ...view, mode })}
          onSignOut={() => signOut.mutate()}
        />
      </div>

      <ImportDialog source={importing} onClose={() => setImporting(null)} onImported={onImported} />

      {filtersOpen ? (
        <Panel className={styles.filters}>
          <div className={styles.panelHead}>
            <IconButton
              icon={PanelLeftClose}
              label="Collapse filters"
              size={16}
              onClick={() => setFiltersOpen(false)}
            />
          </div>
          {/* The filter, in every mode. Only the right panel follows the mode, so the
              sidebar never moves out from under you — and it is still doing something
              while you plan, since the tracks under a plan are the ones it narrowed. */}
          <div className={styles.scroll}>
            <FilterSidebar
              tagTypes={tagTypes.data?.tagTypes ?? []}
              facets={facets.data}
              filter={filter}
              scale={scale}
              activities={activities.data?.activities}
              writing={tagWrite.isPending}
              result={writeResult}
              onChange={(next, mode) => {
                // A filter change is the next action, so the previous write's line has
                // said what it had to say.
                setWriteResult(null)
                setFilter(next, mode)
              }}
              onWrite={onWrite}
            />
          </div>
        </Panel>
      ) : (
        <Panel className={styles.railLeft}>
          <IconButton
            icon={PanelLeftOpen}
            label="Show filters"
            size={16}
            onClick={() => setFiltersOpen(true)}
          />
        </Panel>
      )}

      {listOpen ? (
        <Panel className={styles.list}>
          <div className={styles.panelHeadRight}>
            <IconButton
              icon={PanelRightClose}
              label="Collapse list"
              size={16}
              onClick={() => setListOpen(false)}
            />
          </div>
          {planning ? (
            <PlanPanel
              plan={plan}
              legs={legs}
              track={planned}
              cursor={cursor}
              pending={legsPending}
              error={legsError}
              near={() => mapHandle.current?.centre() ?? null}
              references={references}
              openReference={openReference}
              reading={reading}
              referenceError={readError}
              onOpenReference={openReferenceRow}
              onDismissReference={dismissReference}
              onCancelRead={cancelRead}
              onCursor={setCursor}
              onPlan={setPlan}
              onSelect={openWaypoint}
              onRemove={(index) => {
                setPin(null)
                setPlan(removeWaypoint(plan, index))
              }}
              // A search result raises the same pinned dialog a map click raises, with
              // the name already known — so a searched stop needs no reverse lookup.
              // And the map goes there: a dialog pinned somewhere off screen is a dialog
              // about nothing you can see.
              onPick={(place) => {
                const at = { lat: place.lat, lon: place.lon }
                mapHandle.current?.flyTo(at)
                dropPin(at, place.name)
              }}
              onAddPlace={addPlace}
              onHoverPlace={previewPlace}
            />
          ) : view.activity !== null ? (
            <DetailPanel
              detail={detail.data}
              tagTypes={tagTypes.data?.tagTypes ?? []}
              scale={scale}
              loading={detail.isLoading}
              writing={activityTags.isPending}
              error={message(detail.error)}
              onTags={onActivityTags}
              cursor={cursor}
              onCursor={setCursor}
              onBack={() => select(null)}
            />
          ) : (
            <ActivityList
              activities={activities.data?.activities}
              facets={facets.data}
              tagTypes={tagTypes.data?.tagTypes ?? []}
              filter={filter}
              colourBy={colourBy}
              scale={scale}
              hoveredId={hoveredId}
              selectedId={view.activity}
              loading={activities.isLoading}
              error={listError}
              onHover={setHoveredId}
              onSelect={(id) => select(id)}
              onColourBy={(next) => setView({ ...view, colourBy: next })}
              onSort={(sortKey: SortKey, sortOrder) => setFilter({ ...filter, sortKey, sortOrder })}
              onClear={reset}
            />
          )}
        </Panel>
      ) : (
        <Panel className={styles.railRight}>
          <IconButton
            icon={PanelRightOpen}
            label="Show list"
            size={16}
            onClick={() => setListOpen(true)}
          />
        </Panel>
      )}

      {view.mode === 'analytics' ? (
        <AnalyticsPanel
          // Every card is computed from these rows, which the list and the map have
          // already fetched — so opening the panel costs no request at all.
          rows={activities.data?.activities ?? []}
          filter={filter}
          tagTypes={tagTypes.data?.tagTypes ?? []}
          colourBy={colourBy}
          bucket={view.bucket}
          metric={view.metric}
          calendar={view.calendar}
          calendarColour={view.calendarColour}
          // The panel runs from the sidebar's edge to the window's, and follows it
          // when the sidebar folds to a rail — the same inset the map is padded by.
          insetLeft={insets.left}
          scale={scale}
          onBucket={(bucket) => setView({ ...view, bucket })}
          onMetric={(metric) => setView({ ...view, metric })}
          onCalendar={(calendar) => setView({ ...view, calendar })}
          onCalendarColour={(calendarColour) => setView({ ...view, calendarColour })}
          onColourBy={(colourBy) => setView({ ...view, colourBy })}
          onFilter={setFilter}
          onClose={() => setView({ ...view, mode: 'activities' })}
        />
      ) : null}

      <MapChrome
        grouped={view.grouped}
        basemap={view.basemap}
        planning={planning}
        canFitAll={(planning ? routeExtent : extent) !== null}
        onToggleGrouping={() => setView({ ...view, grouped: !view.grouped })}
        onToggleBasemap={() =>
          setView({ ...view, basemap: view.basemap === 'map' ? 'satellite' : 'map' })
        }
        onFitAll={() => {
          const target = planning ? routeExtent : extent
          if (target) mapHandle.current?.fitBounds(target)
        }}
        onZoom={zoom}
        insetLeft={insets.left}
        insetRight={insets.right}
      />

      <div className={styles.tooNarrow}>
        <strong>Tracks needs a wider window</strong>
        <span>
          The map and both panels want at least {1100} px. This is a desktop tool and does not
          pretend otherwise.
        </span>
      </div>
    </div>
  )
}
