import { useQueryClient } from '@tanstack/react-query'
import type { NewType, SortKey, TagWrite } from '@tracks/core'
import type { LatLon, Waypoint } from '@tracks/routing'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import { ActivityList } from './components/ActivityList.tsx'
import { AnalyticsPanel } from './components/AnalyticsPanel.tsx'
import { DetailPanel } from './components/DetailPanel.tsx'
import { FilterSidebar } from './components/FilterSidebar.tsx'
import { ImportDialog, type ImportSource } from './components/ImportDialog.tsx'
import { MapChrome } from './components/MapChrome.tsx'
import { type MapHandle, MapView } from './components/MapView.tsx'
import { PlanOverview } from './components/PlanOverview.tsx'
import { TopBar } from './components/TopBar.tsx'
import { IconButton } from './components/ui/IconButton.tsx'
import { Panel } from './components/ui/Panel.tsx'
import { type PinTarget, WaypointDialog } from './components/WaypointDialog.tsx'
import { WaypointPanel } from './components/WaypointPanel.tsx'
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
  moveWaypoint,
  type Placement,
  placementAt,
  removeWaypoint,
  setKind,
  updateWaypoint,
} from './lib/plan-ops.ts'
import { planTrack } from './lib/plan-track.ts'
import { geocoder, usePlanLegs } from './lib/routing.ts'
import { useSignOut } from './lib/session.ts'
import { useUrlState } from './lib/url.ts'

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
   * still filtering the tracks underneath, and `activity=` is left exactly as it was —
   * only the plan is destroyed by leaving, and `setView` is where that happens.
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

  const editing = pin?.target.state === 'edit' ? pin.target.index : null

  const openWaypoint = useCallback(
    (index: number) => {
      const waypoint = plan.waypoints[index]
      if (waypoint) setPin({ at: waypoint, target: { state: 'edit', index, waypoint } })
    },
    [plan],
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
        onMapClick={(at, leg) => setPin({ at, target: { state: 'new', leg, name: null } })}
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
              label={planning ? 'Collapse waypoints' : 'Collapse filters'}
              size={16}
              onClick={() => setFiltersOpen(false)}
            />
          </div>
          {/* One left panel, whose content follows the mode. The filter it replaces is
              still in effect on the dimmed tracks and still visible as the top bar's
              chips, so nothing becomes invisible-but-active. */}
          {planning ? (
            <WaypointPanel
              plan={plan}
              legs={legs}
              pending={legsPending}
              error={legsError}
              near={() => mapHandle.current?.centre() ?? null}
              onPlan={setPlan}
              onSelect={openWaypoint}
              onRemove={(index) => {
                setPin(null)
                setPlan(removeWaypoint(plan, index))
              }}
              // A search result raises the same pinned dialog a map click raises, with
              // the name already known — so a searched stop needs no reverse lookup.
              // And the map goes there: a dialog pinned somewhere off screen is a
              // dialog about nothing you can see.
              onPick={(place) => {
                const at = { lat: place.lat, lon: place.lon }
                mapHandle.current?.flyTo(at)
                setPin({ at, target: { state: 'new', leg: null, name: place.name } })
              }}
            />
          ) : (
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
          )}
        </Panel>
      ) : (
        <Panel className={styles.railLeft}>
          <IconButton
            icon={PanelLeftOpen}
            label={planning ? 'Show waypoints' : 'Show filters'}
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
            <PlanOverview
              plan={plan}
              legs={legs}
              track={planned}
              cursor={cursor}
              onCursor={setCursor}
              onPlan={(next) => setPlan(next, 'replace')}
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
        canFitAll={extent !== null}
        onToggleGrouping={() => setView({ ...view, grouped: !view.grouped })}
        onToggleBasemap={() =>
          setView({ ...view, basemap: view.basemap === 'map' ? 'satellite' : 'map' })
        }
        onFitAll={() => extent && mapHandle.current?.fitBounds(extent)}
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
