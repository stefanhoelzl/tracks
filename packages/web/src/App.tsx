import { useQueryClient } from '@tanstack/react-query'
import type { Mode, NewType, SharedView, SortKey, TagWrite } from '@tracks/core'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styles from './App.module.css'
import { ActivityList } from './components/ActivityList.tsx'
import { AnalyticsPanel } from './components/AnalyticsPanel.tsx'
import { DetailPanel } from './components/DetailPanel.tsx'
import type { Range } from './components/ElevationProfile.tsx'
import { FilterDrop } from './components/FilterDrop.tsx'
import { FilterSidebar } from './components/FilterSidebar.tsx'
import { ImportDialog, type ImportSource } from './components/ImportDialog.tsx'
import { MapChrome } from './components/MapChrome.tsx'
import { type MapHandle, MapView } from './components/MapView.tsx'
import { PlanPanel } from './components/PlanPanel.tsx'
import { SignInDialog } from './components/SignIn.tsx'
import { TopBar } from './components/TopBar.tsx'
import { IconButton } from './components/ui/IconButton.tsx'
import { Panel } from './components/ui/Panel.tsx'
import { type Detent, Sheet } from './components/ui/Sheet.tsx'
import { WaypointDialog } from './components/WaypointDialog.tsx'
import { message } from './lib/api.ts'
import { buildScale, type ColourGroup, TYPE_GROUP } from './lib/colour.ts'
import { setBbox } from './lib/filter-ops.ts'
import { useLayout } from './lib/layout.ts'
import { useLibrary } from './lib/library.ts'
import {
  addWaypoint,
  insertionAt,
  kindIsAChoice,
  moveWaypoint,
  nearestLeg,
  removeWaypoint,
  setKind,
  updateWaypoint,
} from './lib/plan-ops.ts'
import { usePlanner } from './lib/planner.ts'
import { type Access, useGiveUp, useSignOut } from './lib/session.ts'
import { titleOf, useDocumentTitle } from './lib/title.ts'
import { useUrlState } from './lib/url.ts'

/** Kept in step with the token file, which the map needs as numbers for its padding. */
const PANEL_W = 300
const LIST_W = 356
const RAIL_W = 44

/**
 * How high the phone's sheet stands when a mode is entered: the list at half, beside its
 * map; the charts at full, since the map says little behind them; a plan at peek, since
 * the map is where a plan is made. After that it stays wherever it is dragged.
 */
const SHEET_FOR: Record<Mode, Detent> = {
  activities: 'half',
  analytics: 'full',
  planning: 'peek',
}

/**
 * The map, the panels and everything they do — for an account, for nobody, or through a
 * share link.
 *
 * A link is the signed-in app with less of it: `shared` set, and `access` whoever is
 * looking, which changes nothing about what they see. The reads go to the link's routes
 * (the `ApiRoot` above this decides that), there is no tag anywhere and nothing writes.
 * What is left is exactly what was shared, narrowed however the viewer likes — and the
 * planner, which needs nobody's rows, over it.
 */
export function App({ access, shared = null }: { access: Access; shared?: SharedView | null }) {
  const { filter, view, plan, error: urlError, setFilter, setView, setPlan, reset } = useUrlState()
  const viewing = shared !== null

  /**
   * Nobody gets the planner, and only the planner.
   *
   * Every other mode is made of an account's rows, so signed out the mode is planning
   * whatever the address says — a link to somebody's activities opens as an empty plan
   * rather than as a form. The address is corrected to match below, so that the plan you
   * make is still yours in planning once you sign in, rather than hidden behind the mode
   * the URL had been naming all along.
   *
   * A lapsed session is still somebody: its view stays as it was behind the dialog.
   */
  const signedIn = access !== null
  /** Whether there are rows on screen — an account's, or a link's. */
  const hasRows = signedIn || viewing
  const mode = hasRows ? view.mode : 'planning'

  useEffect(() => {
    if (!hasRows && view.mode !== 'planning') setView({ ...view, mode: 'planning' }, 'replace')
  }, [hasRows, view, setView])

  /**
   * Planning shadows the other modes rather than replacing their state. The filter is
   * still filtering the tracks underneath — and still on screen, since only the right
   * panel follows the mode — open activity included, so a plan started from one ride
   * has only that ride under it. Only the plan is destroyed by leaving, and `setView` is
   * where that happens.
   */
  const planning = mode === 'planning'
  const signOut = useSignOut()
  const giveUp = useGiveUp()
  /** Whether nobody asked for the sign-in dialog. A lapsed session raises it by itself. */
  const [signingIn, setSigningIn] = useState(false)

  /**
   * Which of the three layouts the window is wide enough for — the one question about the
   * screen the app asks, and asked only here.
   *
   * A phone is read-only: everything that reads is there, and nothing that writes rows —
   * no Import, and no tag editing, one or many. Planning stays whole, because a plan is
   * the address, not a row.
   */
  const layout = useLayout()
  const phone = layout === 'phone'
  const narrow = layout === 'narrow'
  const readOnly = viewing || phone

  // Transient by design: which panels are folded and what the pointer is over say
  // nothing about what you are looking at, so they have no business in a bookmark.
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [listOpen, setListOpen] = useState(true)

  /**
   * Between the phone and the desktop there is room for the map and one panel, not two:
   * opening either folds the other to its rail. The list wins on the way in, since it is
   * what the map is being read against.
   */
  const openFilters = (open: boolean) => {
    setFiltersOpen(open)
    if (open && narrow) setListOpen(false)
  }
  const openList = (open: boolean) => {
    setListOpen(open)
    if (open && narrow) setFiltersOpen(false)
  }
  useEffect(() => {
    if (narrow) setFiltersOpen(false)
  }, [narrow])

  // The phone's sheet and filter, and the two lengths the map is padded by: where the top
  // bar ends, and how tall the sheet stands.
  const [detent, setDetent] = useState<Detent>(SHEET_FOR[mode])
  const [dropOpen, setDropOpen] = useState(false)
  const [sheetHeight, setSheetHeight] = useState(0)
  const [topBottom, setTopBottom] = useState(0)
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDetent(SHEET_FOR[mode])
  }, [mode])

  useLayoutEffect(() => {
    const node = topRef.current
    if (!node || !phone) return
    const measure = () => setTopBottom(node.offsetTop + node.offsetHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [phone])
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [importing, setImporting] = useState<ImportSource | null>(null)
  // Which point of the selected track the elevation cursor is on. It is one number
  // whichever end moved — the profile sets it on hover, the map sets it on hover, and
  // both read it back — so the two can never disagree about which point is meant.
  const [cursor, setCursor] = useState<number | null>(null)

  /**
   * The stretch two bars on the elevation profile enclose, in metres along whichever track the
   * cursor belongs to — and how long that track is, so the map measures it the same way.
   *
   * It lives here for the same reason the cursor does: the chart and the map are two views of one
   * selection, and only the thing that owns both can hold it.
   */
  const [range, setRange] = useState<Range | null>(null)
  const queryClient = useQueryClient()

  const mapHandle = useRef<MapHandle>(null)

  const { tagTypes, activities, tracks, facets, detail, tagWrite, activityTags } = useLibrary(
    filter,
    filter.id,
    viewing,
  )

  /**
   * The tab says what you are looking at.
   *
   * react-query's shape is flattened here rather than inside `titleOf`, so the ladder
   * stays a statement about the app's state and knows nothing about fetching. `detail`
   * is pending whenever it is disabled, which is why the selection is asked about
   * first — an empty list would otherwise load forever in the tab strip.
   *
   * A lapsed session says so instead: a tab left in the background is otherwise still
   * naming an activity it can no longer show you.
   */
  const title = titleOf({
    mode,
    plan,
    activity: detail.data?.activity ?? null,
    pending: filter.id !== null && detail.isPending,
  })
  // Through a link, its label is the quiet case the brand is for an account.
  useDocumentTitle(
    access?.lapsed ? 'Sign in' : title === '' && shared?.label ? shared.label : title,
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
  // A link carries no tags, so the one colouring it can offer is the year.
  const colourBy = viewing ? 'year' : (view.colourBy ?? tagTypes.data?.tagTypes[0]?.name ?? null)

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

  const insets = phone
    ? // On a phone nothing is beside the map: the bar is above it and the sheet below.
      { left: 0, right: 0, top: topBottom, bottom: sheetHeight }
    : {
        // Signed out there is no sidebar at all, not even its rail: it has nothing to filter.
        left: (hasRows ? (filtersOpen ? PANEL_W : RAIL_W) : 0) + 16,
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

  const {
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
  } = usePlanner({ plan, setPlan, planning, mapHandle, setCursor })

  /**
   * Opening an activity is a filter change: it narrows everything to that one, which is
   * what makes *fit everything* frame it. It is also the one thing that invalidates the
   * cursor: that indexes into the track that was open, and the next one is a different
   * array of a different length.
   */
  const select = useCallback(
    (id: number | null) => {
      setCursor(null)
      setFilter({ ...filter, id })
      // An activity opened from the map on a phone is read in the sheet, so the sheet rises
      // far enough to show it.
      if (id !== null && phone) setDetent((was) => (was === 'peek' ? 'half' : was))
    },
    [filter, setFilter, phone],
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

  /** The filter, as the desktop's sidebar and the phone's drop-down both hold it. */
  const sidebar = (
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
      onWrite={readOnly ? undefined : onWrite}
    />
  )

  /** What the right-hand panel holds on the desktop, and the sheet on a phone. */
  const panel = planning ? (
    <PlanPanel
      plan={plan}
      legs={legs}
      track={planned}
      cursor={cursor}
      onRange={setRange}
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
  ) : filter.id !== null ? (
    <DetailPanel
      detail={detail.data}
      tagTypes={tagTypes.data?.tagTypes ?? []}
      scale={scale}
      loading={detail.isLoading}
      writing={activityTags.isPending}
      error={message(detail.error)}
      onTags={readOnly ? undefined : onActivityTags}
      cursor={cursor}
      onRange={setRange}
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
      selectedId={filter.id}
      loading={activities.isLoading}
      error={listError}
      onHover={setHoveredId}
      onSelect={(id) => select(id)}
      onColourBy={(next) => setView({ ...view, colourBy: next })}
      onSort={(sortKey: SortKey, sortOrder) => setFilter({ ...filter, sortKey, sortOrder })}
      onClear={reset}
      totals={phone}
    />
  )

  /** The analytics, as the desktop's slide-over and the phone's sheet both show them. */
  const analytics = {
    // Every card is computed from these rows, which the list and the map have
    // already fetched — so opening the panel costs no request at all.
    rows: activities.data?.activities ?? [],
    filter,
    tagTypes: tagTypes.data?.tagTypes ?? [],
    colourBy,
    bucket: view.bucket,
    metric: view.metric,
    calendar: view.calendar,
    calendarColour: view.calendarColour,
    // The panel runs from the sidebar's edge to the window's, and follows it
    // when the sidebar folds to a rail — the same inset the map is padded by.
    insetLeft: insets.left,
    scale,
    onBucket: (bucket: typeof view.bucket) => setView({ ...view, bucket }),
    onMetric: (metric: typeof view.metric) => setView({ ...view, metric }),
    onCalendar: (calendar: NonNullable<typeof view.calendar>) => setView({ ...view, calendar }),
    onCalendarColour: (calendarColour: typeof view.calendarColour) =>
      setView({ ...view, calendarColour }),
    onColourBy: (colourBy: string) => setView({ ...view, colourBy }),
    onFilter: setFilter,
    onClose: () => setView({ ...view, mode: 'activities' }),
  }

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
        selectedId={filter.id}
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
        range={range}
        pending={legsPending}
        preview={preview}
        pinAt={pin?.at ?? null}
        pin={
          pin ? (
            <WaypointDialog
              target={pin.target}
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
        // A finger held on the map bends the nearest leg there, as the phone app's editor does.
        onLongPress={(at) => {
          const leg = nearestLeg(plan, legs, at)
          if (leg === null) return
          setPin(null)
          setPlan(
            addWaypoint(
              plan,
              { ...at, kind: 'routing', name: null },
              insertionAt(plan, legs, leg, at),
            ),
          )
        }}
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

      <div
        ref={topRef}
        className={phone ? styles.topPhone : styles.top}
        style={phone ? undefined : { left: 16, right: 16 }}
      >
        <TopBar
          summary={facets.data?.summary}
          filter={filter}
          tagTypes={tagTypes.data?.tagTypes ?? []}
          scale={scale}
          mode={mode}
          view={view}
          plan={plan}
          email={access?.email ?? null}
          shared={shared}
          onChange={setFilter}
          onClear={reset}
          onImport={setImporting}
          onMode={(mode) => setView({ ...view, mode })}
          onOpenShare={setFilter}
          onSignIn={() => setSigningIn(true)}
          onSignOut={() => signOut.mutate()}
          phone={phone}
          filtersOpen={dropOpen}
          onFilters={() => setDropOpen((open) => !open)}
        />
      </div>

      <SignInDialog
        open={access === null ? signingIn : access.lapsed}
        lapsed={access?.lapsed ?? false}
        onCancel={() => {
          setSigningIn(false)
          if (access?.lapsed) giveUp()
        }}
        onSignedIn={() => setSigningIn(false)}
      />

      {viewing ? null : (
        <ImportDialog
          source={importing}
          onClose={() => setImporting(null)}
          onImported={onImported}
        />
      )}

      {phone ? (
        <>
          {/* One sheet, holding what the right-hand panel holds on the desktop — the same
              components — or the analytics, which on a phone have nowhere else to go. */}
          <Sheet
            // Lowered while the filter is down, so the map between the two is left to show
            // the tracks narrowing; closing the filter puts it back where it was.
            detent={hasRows && dropOpen ? 'peek' : detent}
            top={topBottom}
            label={mode === 'planning' ? 'Plan' : mode === 'analytics' ? 'Analytics' : 'Activities'}
            onDetent={setDetent}
            onHeight={setSheetHeight}
          >
            {mode === 'analytics' ? <AnalyticsPanel {...analytics} contained /> : panel}
          </Sheet>

          {hasRows && dropOpen ? (
            <FilterDrop count={facets.data?.summary.count} onClose={() => setDropOpen(false)}>
              {sidebar}
            </FilterDrop>
          ) : null}
        </>
      ) : (
        <>
          {!hasRows ? null : filtersOpen ? (
            <Panel className={styles.filters}>
              <div className={styles.panelHead}>
                <IconButton
                  icon={PanelLeftClose}
                  label="Collapse filters"
                  size={16}
                  onClick={() => openFilters(false)}
                />
              </div>
              {/* The filter, in every mode. Only the right panel follows the mode, so the
                  sidebar never moves out from under you — and it is still doing something
                  while you plan, since the tracks under a plan are the ones it narrowed. */}
              <div className={styles.scroll}>{sidebar}</div>
            </Panel>
          ) : (
            <Panel className={styles.railLeft}>
              <IconButton
                icon={PanelLeftOpen}
                label="Show filters"
                size={16}
                onClick={() => openFilters(true)}
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
                  onClick={() => openList(false)}
                />
              </div>
              {panel}
            </Panel>
          ) : (
            <Panel className={styles.railRight}>
              <IconButton
                icon={PanelRightOpen}
                label="Show list"
                size={16}
                onClick={() => openList(true)}
              />
            </Panel>
          )}

          {mode === 'analytics' ? <AnalyticsPanel {...analytics} /> : null}
        </>
      )}

      <MapChrome
        grouped={view.grouped}
        basemap={view.basemap}
        planning={planning}
        open={filter.id !== null}
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
        phone={phone}
        hidden={phone && detent === 'full' && !dropOpen}
      />
    </div>
  )
}
