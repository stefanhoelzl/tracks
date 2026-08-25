import type { SortKey } from '@tracks/core'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import styles from './App.module.css'
import { ActivityList } from './components/ActivityList.tsx'
import { DetailPanel } from './components/DetailPanel.tsx'
import { FilterSidebar } from './components/FilterSidebar.tsx'
import { MapChrome } from './components/MapChrome.tsx'
import { type MapHandle, MapView } from './components/MapView.tsx'
import { TopBar } from './components/TopBar.tsx'
import { IconButton } from './components/ui/IconButton.tsx'
import { Panel } from './components/ui/Panel.tsx'
import {
  ApiFailure,
  useActivities,
  useActivityDetail,
  useFacets,
  useTagTypes,
  useTracks,
} from './lib/api.ts'
import { setBbox } from './lib/filter-ops.ts'
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

export function App() {
  const { filter, view, error: urlError, setFilter, setView, reset } = useUrlState()

  // Transient by design: which panels are folded and what the pointer is over say
  // nothing about what you are looking at, so they have no business in a bookmark.
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [listOpen, setListOpen] = useState(true)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [areaFilter, setAreaFilter] = useState(false)

  const mapHandle = useRef<MapHandle>(null)

  const tagTypes = useTagTypes()
  const activities = useActivities(filter)
  const tracks = useTracks(filter)
  const facets = useFacets(filter)
  const detail = useActivityDetail(view.activity)

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

  const toggleArea = useCallback(() => {
    setAreaFilter((was) => {
      if (was) setFilter(setBbox(filter, null))
      return !was
    })
  }, [filter, setFilter])

  const zoom = useCallback((delta: number) => mapHandle.current?.zoomBy(delta), [])

  const listError = message(activities.error) ?? message(tracks.error) ?? urlError

  return (
    <div className={styles.app}>
      <MapView
        ref={mapHandle}
        tracks={tracks.data}
        detail={detail.data}
        colourBy={view.colourBy}
        filter={filter}
        hoveredId={hoveredId}
        selectedId={view.activity}
        areaFilter={areaFilter}
        panelInsets={insets}
        onHover={setHoveredId}
        onSelect={(id) => setView({ ...view, activity: id })}
        onViewportChange={onViewportChange}
      />

      <div className={styles.top} style={{ left: 16, right: 16 }}>
        <TopBar summary={facets.data?.summary} />
      </div>

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
          <div className={styles.scroll}>
            <FilterSidebar
              tagTypes={tagTypes.data?.tagTypes ?? []}
              facets={facets.data}
              filter={filter}
              areaFilter={areaFilter}
              onChange={setFilter}
              onClearArea={() => {
                setAreaFilter(false)
                setFilter(setBbox(filter, null))
              }}
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
          {view.activity !== null ? (
            <DetailPanel
              detail={detail.data}
              tagTypes={tagTypes.data?.tagTypes ?? []}
              loading={detail.isLoading}
              error={message(detail.error)}
              onBack={() => setView({ ...view, activity: null })}
            />
          ) : (
            <ActivityList
              activities={activities.data?.activities}
              facets={facets.data}
              tagTypes={tagTypes.data?.tagTypes ?? []}
              filter={filter}
              colourBy={view.colourBy}
              hoveredId={hoveredId}
              selectedId={view.activity}
              loading={activities.isLoading}
              error={listError}
              onHover={setHoveredId}
              onSelect={(id) => setView({ ...view, activity: id })}
              onColourBy={(colourBy) => setView({ ...view, colourBy })}
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

      <MapChrome
        areaFilter={areaFilter}
        onToggleArea={toggleArea}
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
