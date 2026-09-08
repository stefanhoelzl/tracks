import type { ActivityDetail, Filter, TrackCollection } from '@tracks/core'
import { formatFilter } from '@tracks/core'
import type { LatLon, Leg } from '@tracks/routing'
import type { GeoJSONSource, LngLatBoundsLike, MapLayerMouseEvent, MapLibreMap } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { type ReactNode, type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { activityColour, type ColourScale, emphasise } from '../lib/colour.ts'
import { nearestIndex } from '../lib/geo.ts'
import type { Plan } from '../lib/plan.ts'
import { addWaypoint, insertionAt } from '../lib/plan-ops.ts'
import { type Basemap, basemapStyle } from '../map/basemap.ts'
import { ClusterMarkers } from '../map/clusters.ts'
import {
  addTrackLayers,
  CURSOR_SOURCE,
  FOCUS_LAYER,
  paint,
  paintTracks,
  SELECTED_CASING_LAYER,
  SELECTED_SOURCE,
  STARTS_SOURCE,
  startPoints,
  TRACKS_LAYER,
  TRACKS_SOURCE,
} from '../map/layers.ts'
import {
  addPlanLayers,
  beelineFeatures,
  PLAN_CASING_LAYER,
  PLAN_FAILED_LAYER,
  PLAN_LINE_LAYER,
  PLAN_POI_LAYER,
  PLAN_POINTS_SOURCE,
  PLAN_SHAPING_LAYER,
  PLAN_SOURCE,
  routeFeatures,
  showPlan,
  waypointFeatures,
} from '../map/plan-layers.ts'
import styles from './MapView.module.css'

/**
 * The map.
 *
 * Driven imperatively: every interesting thing here — hover linking against a
 * feature filter, a camera that is sometimes the filter, a fit that must wait for
 * the filter to settle — is a sequence of side effects on one long-lived object, and
 * a declarative wrapper would be a layer to fight rather than a layer to use.
 */

/** The map is the filter while this is on, so it must not chase itself. */
const MOVE_MS = 250

const INITIAL = { center: [11.0, 47.5] as [number, number], zoom: 5 }

function boundsOfCoordinates(
  coordinates: ReadonlyArray<ReadonlyArray<number>>,
): LngLatBoundsLike | null {
  const bounds = new maplibregl.LngLatBounds()
  for (const [lon, lat] of coordinates) {
    if (lon !== undefined && lat !== undefined) bounds.extend([lon, lat])
  }
  return bounds.isEmpty() ? null : bounds
}

/** What the map chrome needs from the map, and nothing more. */
export interface MapHandle {
  zoomBy: (delta: number) => void
  fitBounds: (bbox: [number, number, number, number]) => void
  /** Where the camera is pointing, so a search can be biased towards it. */
  centre: () => LatLon | null
}

/**
 * A drag in progress, as the waypoint array it is previewing.
 *
 * Both gestures reduce to the same thing — *these waypoints, with the one at `index`
 * following the cursor* — which is why dragging the line and dragging a marker share a
 * preview, a commit path and a rule about history. The line's provisional shaping point
 * is spliced in at `mousedown` and never moves in the array afterwards, so the leg it
 * belongs to cannot change halfway through the gesture.
 */
interface Drag {
  kind: 'waypoint' | 'shaping'
  index: number
  waypoints: Plan['waypoints']
  moved: boolean
}

export function MapView({
  ref,
  tracks,
  detail,
  colourBy,
  scale,
  grouped,
  basemap,
  filter,
  extent,
  hoveredId,
  selectedId,
  cursor,
  panelInsets,
  planning,
  plan,
  legs,
  plannedTrack,
  pin,
  pinAt,
  onHover,
  onCursor,
  onSelect,
  onViewportChange,
  onMapClick,
  onWaypointClick,
  onWaypointMove,
  onShapingDrop,
}: {
  ref?: Ref<MapHandle>
  tracks: TrackCollection | undefined
  detail: ActivityDetail | undefined
  colourBy: string | null
  scale: ColourScale
  grouped: boolean
  /** Which basemap is under the tracks. */
  basemap: Basemap
  filter: Filter
  /** Everything matching the filter without its bbox — what *view all* frames. */
  extent: [number, number, number, number] | null
  hoveredId: number | null
  selectedId: number | null
  /** Which point of the selected track the elevation cursor is on. */
  cursor: number | null
  /** Left and right panel widths, so a fit centres in the visible map, not under glass. */
  panelInsets: { left: number; right: number }
  /** While this is on the tracks are dim and inert, and every click means *waypoint*. */
  planning: boolean
  plan: Plan
  /** One slot per leg; `undefined` while that leg is still in flight. */
  legs: Array<Leg | undefined>
  /** Every routed leg end to end — what the elevation cursor indexes into. */
  plannedTrack: Array<[number, number]>
  /** The pinned dialog, positioned at `pinAt` and moved by the map, not by the page. */
  pin: ReactNode
  pinAt: LatLon | null
  onHover: (id: number | null) => void
  onCursor: (index: number | null) => void
  onSelect: (id: number | null) => void
  onViewportChange: (bbox: [number, number, number, number]) => void
  /** A click on open map or on the route. `leg` is which leg it landed on, if any. */
  onMapClick: (at: LatLon, leg: number | null) => void
  onWaypointClick: (index: number) => void
  onWaypointMove: (index: number, at: LatLon) => void
  /** A drag off the line: insert a shaping point at `index`, where it was let go. */
  onShapingDrop: (index: number, at: LatLon) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const clusters = useRef<ClusterMarkers | null>(null)
  const [ready, setReady] = useState(false)
  const drag = useRef<Drag | null>(null)
  /** A drag ends in a click MapLibre will still deliver; this is how it is ignored. */
  const suppressClick = useRef(false)
  /** The marker element the pinned dialog is portalled into, once one exists. */
  const [pinHost, setPinHost] = useState<HTMLElement | null>(null)

  useImperativeHandle(ref, () => ({
    zoomBy: (delta: number) =>
      map.current?.zoomTo(map.current.getZoom() + delta, { duration: 250 }),
    // Padded past the panels, so a track at the edge does not land under glass. The
    // move writes the viewport back as the new bbox, like any other.
    centre: () => {
      const at = map.current?.getCenter()
      return at ? { lat: at.lat, lon: at.lng } : null
    },
    fitBounds: ([west, south, east, north]: [number, number, number, number]) =>
      map.current?.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: {
            top: 88 + 24,
            bottom: 40,
            left: panelInsets.left + 32,
            right: panelInsets.right + 32,
          },
          duration: 700,
          maxZoom: 14,
        },
      ),
  }))

  // Read inside listeners that are attached once; a stale closure here would mean
  // panning writes a bbox after the toggle was turned off.
  const live = useRef({
    grouped,
    detail,
    planning,
    plan,
    legs,
    plannedTrack,
    onViewportChange,
    onSelect,
    onHover,
    onCursor,
    onMapClick,
    onWaypointClick,
    onWaypointMove,
    onShapingDrop,
  })
  live.current = {
    grouped,
    detail,
    planning,
    plan,
    legs,
    plannedTrack,
    onViewportChange,
    onSelect,
    onHover,
    onCursor,
    onMapClick,
    onWaypointClick,
    onWaypointMove,
    onShapingDrop,
  }

  /**
   * The basemap this map is first dressed with, deliberately frozen at mount.
   *
   * A ref rather than the prop, because the effect below must not be reactive in it:
   * re-running it would tear down and rebuild the entire map on a basemap toggle,
   * where what is wanted is to re-style the map that already exists. That is the swap
   * effect's job, further down.
   */
  const initialBasemap = useRef(basemap)

  useEffect(() => {
    if (!container.current) return
    let cancelled = false

    const instance = new maplibregl.Map({
      container: container.current,
      style: { version: 8, sources: {}, layers: [] },
      center: INITIAL.center,
      zoom: INITIAL.zoom,
      attributionControl: false,
      // Ours lives in the map chrome, alongside the scale.
    })
    map.current = instance

    // The style is fetched (the elevation TileJSON is a real request), so the map
    // exists before it is dressed — which also gets a grey canvas up immediately
    // rather than waiting on the network for first paint.
    basemapStyle(initialBasemap.current)
      .then((style) => {
        if (cancelled) return
        instance.setStyle(style)
        instance.once('styledata', () => {
          if (cancelled) return
          addTrackLayers(instance)
          addPlanLayers(instance)
          clusters.current = new ClusterMarkers(instance)
          setReady(true)
        })
      })
      .catch((error) => console.error('basemap failed to load', error))

    // Inert while planning, not merely dim. Every click on the map then means "put a
    // waypoint here", and a click that might instead select a track is a click you
    // would have to aim.
    instance.on('mousemove', TRACKS_LAYER, (event: MapLayerMouseEvent) => {
      if (live.current.planning) return
      const id = event.features?.[0]?.properties?.id
      instance.getCanvas().style.cursor = 'pointer'
      if (typeof id === 'number') live.current.onHover(id)
    })
    instance.on('mouseleave', TRACKS_LAYER, () => {
      if (live.current.planning) return
      instance.getCanvas().style.cursor = ''
      live.current.onHover(null)
    })
    instance.on('click', TRACKS_LAYER, (event: MapLayerMouseEvent) => {
      if (live.current.planning) return
      const id = event.features?.[0]?.properties?.id
      if (typeof id === 'number') live.current.onSelect(id)
    })

    /**
     * The map half of the elevation cursor.
     *
     * Bound to the casing rather than to the line, because the casing is the wider of
     * the two and the pointer is being asked to follow a track a few pixels across.
     * The answer is an index into the same coordinate array the profile plots, so
     * both ends of the link are talking about the same point rather than about two
     * roundings of one position.
     */
    instance.on('mousemove', SELECTED_CASING_LAYER, (event: MapLayerMouseEvent) => {
      const coordinates = live.current.detail?.track.coordinates
      if (!coordinates?.length) return
      const index = nearestIndex(coordinates, event.lngLat.lng, event.lngLat.lat)
      if (index >= 0) live.current.onCursor(index)
    })
    instance.on('mouseleave', SELECTED_CASING_LAYER, () => live.current.onCursor(null))

    // The plan's half of the same link, over the same mechanism — one index into the
    // array both ends are reading, so neither can be talking about a different point.
    instance.on('mousemove', PLAN_CASING_LAYER, (event: MapLayerMouseEvent) => {
      if (drag.current) return
      const coordinates = live.current.plannedTrack
      if (!coordinates.length) return
      const index = nearestIndex(coordinates, event.lngLat.lng, event.lngLat.lat)
      if (index >= 0) live.current.onCursor(index)
    })
    instance.on('mouseleave', PLAN_CASING_LAYER, () => live.current.onCursor(null))

    // --- Planning ----------------------------------------------------------

    /** Only the layers that exist: a style reload takes them, and querying one throws. */
    const present = (ids: string[]) => ids.filter((id) => instance.getLayer(id))

    const at = (event: MapLayerMouseEvent): LatLon => ({
      lat: event.lngLat.lat,
      lon: event.lngLat.lng,
    })

    const endDrag = () => {
      drag.current = null
      instance.dragPan.enable()
      instance.getCanvas().style.cursor = ''
    }

    const beginDrag = (state: Drag) => {
      drag.current = state
      instance.dragPan.disable()
      instance.getCanvas().style.cursor = 'grabbing'
    }

    const grabWaypoint = (event: MapLayerMouseEvent) => {
      if (!live.current.planning || drag.current) return
      const index = event.features?.[0]?.properties?.index
      if (typeof index !== 'number') return
      // Or the map pans out from under the waypoint being moved.
      event.preventDefault()
      beginDrag({
        kind: 'waypoint',
        index,
        waypoints: live.current.plan.waypoints,
        moved: false,
      })
    }

    instance.on('mousedown', PLAN_POI_LAYER, grabWaypoint)
    instance.on('mousedown', PLAN_SHAPING_LAYER, grabWaypoint)

    /**
     * Dragging the line pulls a shaping point out of it.
     *
     * The direct-manipulation form of the rule that a ROUTING point always inserts into
     * the nearest leg — here the leg is not the nearest one, it is the one under the
     * pointer. Its position in the array is settled at `mousedown` and never moves
     * again, so the leg it belongs to cannot change halfway through the gesture.
     */
    instance.on('mousedown', PLAN_LINE_LAYER, (event: MapLayerMouseEvent) => {
      if (!live.current.planning || drag.current) return
      const leg = event.features?.[0]?.properties?.leg
      if (typeof leg !== 'number' || leg < 0) return

      const point = at(event)
      const index = insertionAt(live.current.plan, live.current.legs, leg, point)
      event.preventDefault()
      beginDrag({
        kind: 'shaping',
        index,
        waypoints: addWaypoint(live.current.plan, { ...point, kind: 'routing', name: null }, index)
          .waypoints,
        moved: false,
      })
    })

    instance.on('mousemove', (event: MapLayerMouseEvent) => {
      const state = drag.current
      if (!state) return
      state.moved = true

      const point = at(event)
      const waypoints = state.waypoints.map((waypoint, index) =>
        index === state.index ? { ...waypoint, lat: point.lat, lon: point.lon } : waypoint,
      )
      // Straight lines to the cursor while the gesture lasts: instant, free, and
      // honest about being provisional. The real request goes on release, which is
      // what keeps one drag to one request rather than forty.
      instance.getSource<GeoJSONSource>(PLAN_SOURCE)?.setData(beelineFeatures(waypoints))
      instance.getSource<GeoJSONSource>(PLAN_POINTS_SOURCE)?.setData(waypointFeatures(waypoints))
    })

    instance.on('mouseup', (event: MapLayerMouseEvent) => {
      const state = drag.current
      if (!state) return
      endDrag()
      if (!state.moved) return

      suppressClick.current = true
      const point = at(event)
      if (state.kind === 'waypoint') live.current.onWaypointMove(state.index, point)
      else live.current.onShapingDrop(state.index, point)
    })

    /**
     * One click handler rather than one per layer.
     *
     * A waypoint, then the route, then open map — asked in that order, of the same
     * point, so a click can only ever mean one of them. The casing is queried alongside
     * the line because it is the wider of the two, and a route is a few pixels across.
     */
    instance.on('click', (event: MapLayerMouseEvent) => {
      if (!live.current.planning) return
      if (suppressClick.current) {
        suppressClick.current = false
        return
      }

      const onWaypoint = instance.queryRenderedFeatures(event.point, {
        layers: present([PLAN_POI_LAYER, PLAN_SHAPING_LAYER]),
      })
      const index = onWaypoint[0]?.properties?.index
      if (typeof index === 'number') {
        live.current.onWaypointClick(index)
        return
      }

      const onRoute = instance.queryRenderedFeatures(event.point, {
        layers: present([PLAN_LINE_LAYER, PLAN_CASING_LAYER, PLAN_FAILED_LAYER]),
      })
      const leg = onRoute[0]?.properties?.leg
      live.current.onMapClick(at(event), typeof leg === 'number' && leg >= 0 ? leg : null)
    })

    instance.on('render', () => {
      if (live.current.grouped) clusters.current?.refresh()
    })

    let moveTimer: ReturnType<typeof setTimeout> | undefined
    instance.on('moveend', () => {
      clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        const [[west, south], [east, north]] = instance.getBounds().toArray()
        live.current.onViewportChange([west!, south!, east!, north!])
      }, MOVE_MS)
    })

    return () => {
      cancelled = true
      clearTimeout(moveTimer)
      clusters.current?.clear()
      clusters.current = null
      instance.remove()
      map.current = null
    }
  }, [])

  // --- Data -----------------------------------------------------------------

  useEffect(() => {
    if (!ready || !map.current || !tracks) return
    map.current.getSource<GeoJSONSource>(TRACKS_SOURCE)?.setData(paint(tracks, colourBy, scale))
    map.current
      .getSource<GeoJSONSource>(STARTS_SOURCE)
      ?.setData(startPoints(tracks, colourBy, scale))
  }, [ready, tracks, colourBy, scale])

  // Hovering a row highlights its track; selecting one focuses it and dims the rest.
  useEffect(() => {
    if (!ready || !map.current) return
    paintTracks(map.current, {
      focusId: hoveredId ?? selectedId,
      grouped,
      dimmed: planning,
    })
  }, [ready, hoveredId, selectedId, grouped, planning])

  // --- The plan -------------------------------------------------------------

  useEffect(() => {
    if (!ready || !map.current) return
    showPlan(map.current, planning)
  }, [ready, planning])

  // Not while a drag owns these sources: it is painting a preview into them, and this
  // would overwrite it with the route the preview is replacing.
  useEffect(() => {
    if (!ready || !map.current || drag.current) return
    map.current.getSource<GeoJSONSource>(PLAN_SOURCE)?.setData(routeFeatures(legs))
    map.current
      .getSource<GeoJSONSource>(PLAN_POINTS_SOURCE)
      ?.setData(waypointFeatures(plan.waypoints))
  }, [ready, legs, plan.waypoints])

  /**
   * Swapping the basemap.
   *
   * `setStyle` replaces the whole style, which takes the track layers *and their
   * sources* with it. So this rebuilds them exactly as the first load does, and drops
   * `ready` while it happens — every effect that fills a source depends on `ready`, so
   * flipping it is what re-runs them against the new style rather than into nothing.
   *
   * Staleness is checked against `styled`, deliberately, and not with a cancelled flag
   * set from a cleanup. `setReady(false)` below re-runs this effect, which would run
   * that cleanup and cancel the very load it had just started — the map would clear its
   * clusters, drop `ready`, and wait forever for a style that had been told to stop.
   */
  const styled = useRef<Basemap | null>(null)
  useEffect(() => {
    if (!ready || !map.current) return
    if (styled.current === null) {
      styled.current = basemap
      return
    }
    if (styled.current === basemap) return
    styled.current = basemap

    const instance = map.current
    setReady(false)
    clusters.current?.clear()
    clusters.current = null

    basemapStyle(basemap)
      .then((style) => {
        // Still the basemap that was asked for? A second click while this was in
        // flight has already moved `styled` on, and that run owns the map now.
        if (styled.current !== basemap) return
        instance.setStyle(style)
        instance.once('styledata', () => {
          if (styled.current !== basemap) return
          addTrackLayers(instance)
          addPlanLayers(instance)
          clusters.current = new ClusterMarkers(instance)
          setReady(true)
        })
      })
      .catch((error) => console.error('basemap failed to load', error))
  }, [ready, basemap])

  // Ungrouped, the donuts have nothing to say — the tracks themselves are drawn.
  useEffect(() => {
    if (!grouped) clusters.current?.clear()
  }, [grouped])

  // Full resolution, drawn over the simplified line it replaces.
  useEffect(() => {
    if (!ready || !map.current) return
    const source = map.current.getSource<GeoJSONSource>(SELECTED_SOURCE)
    if (!source) return

    // Cleared while planning even though the activity is still selected: the plan wears
    // this exact paint, and two things drawn as *the one you are looking at* is one too
    // many. The selection is shadowed, not discarded — leaving planning restores it.
    if (!detail || planning) {
      source.setData({ type: 'FeatureCollection', features: [] })
      return
    }
    source.setData({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          // Its own colour, turned up: same hue, so selecting a track never changes
          // what the track is telling you, but findable among a dozen painted like it.
          properties: {
            // `colourHi`, the same key the simplified line's highlight reads, so hover
            // and selection are painted by one layer definition from one property.
            colourHi: emphasise(
              activityColour(
                detail.activity.tags,
                Number(detail.activity.localDate.slice(0, 4)),
                colourBy,
                scale,
              ),
            ),
          },
          geometry: {
            type: 'LineString',
            coordinates: detail.track.coordinates,
          },
        },
      ],
    })
  }, [ready, detail, planning, colourBy, scale])

  // The dot the profile is pointing at. Cleared by an absent cursor and by a detail
  // that has gone — an index into a track that is no longer loaded is not a place.
  useEffect(() => {
    if (!ready || !map.current) return
    const source = map.current.getSource<GeoJSONSource>(CURSOR_SOURCE)
    if (!source) return

    // Whichever track is on screen: while planning the detail is not drawn at all, so
    // the cursor indexes into the plan instead — one mechanism, two sources.
    const coordinates = planning ? plannedTrack : detail?.track.coordinates
    const point = cursor === null ? undefined : coordinates?.[cursor]
    source.setData({
      type: 'FeatureCollection',
      features: point
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } }]
        : [],
    })
  }, [ready, cursor, detail, planning, plannedTrack])

  // --- Camera ---------------------------------------------------------------

  /**
   * What the camera is currently framing, as a cause rather than as a result.
   *
   * The bbox is deliberately not in it. Every fit ends in a `moveend` that writes the
   * viewport back as the new bbox, so keying on the whole filter would make each fit
   * the reason for the next one. Keyed on what the user *did* — changed a filter,
   * picked an activity — a fit's own write cannot retrigger it, and the loop that cost
   * the auto-fit in the first place cannot form.
   */
  const fitKey = `${formatFilter({ ...filter, bbox: null })}|${selectedId ?? ''}`
  const fitted = useRef<string | null>(null)

  useEffect(() => {
    if (!ready || !map.current || fitted.current === fitKey) return

    // Not while planning: the plan has its own opening fit, and framing everything that
    // matches the filter would fly the camera off the route being drawn. Claiming the
    // key rather than returning early means leaving planning does not then fit either —
    // where the camera is, at that point, is where you put it.
    if (planning) {
      fitted.current = fitKey
      return
    }

    // A selected activity is framed on its own; anything else frames everything that
    // matches, which `extent` gives with the viewport term dropped — the tracks payload
    // cannot, since the viewport is exactly what removed the rest of it.
    const target =
      selectedId !== null
        ? detail && boundsOfCoordinates(detail.track.coordinates)
        : extent && boundsOfCoordinates([extent.slice(0, 2), extent.slice(2, 4)])

    // Not yet: the detail or the facets for this filter are still in flight. Leaving
    // `fitted` alone means this runs again when they land, rather than never.
    if (!target) return

    fitted.current = fitKey
    map.current.fitBounds(target, {
      padding: {
        top: 88 + 24,
        bottom: 40,
        left: panelInsets.left + 32,
        right: panelInsets.right + 32,
      },
      duration: 700,
      maxZoom: 14,
    })
  }, [ready, fitKey, extent, detail, selectedId, planning, panelInsets.left, panelInsets.right])

  /**
   * A shared plan link, framed once.
   *
   * Only when planning is entered with a plan already in hand, which is exactly the
   * link case — a `?mode=planning#plan=…` that opened on the wrong continent would be
   * reported as broken before anything else about it. Starting a plan from nothing
   * claims the flag without moving anything, so the camera never jumps out from under
   * the first waypoint someone places.
   */
  const fittedPlan = useRef(false)
  useEffect(() => {
    if (!ready || !map.current || fittedPlan.current || !planning) return
    fittedPlan.current = true

    const bounds = boundsOfCoordinates(
      live.current.plan.waypoints.map((waypoint) => [waypoint.lon, waypoint.lat]),
    )
    if (!bounds) return

    map.current.fitBounds(bounds, {
      padding: {
        top: 88 + 24,
        bottom: 40,
        left: panelInsets.left + 32,
        right: panelInsets.right + 32,
      },
      duration: 0,
      maxZoom: 14,
    })
  }, [ready, planning, panelInsets.left, panelInsets.right])

  /**
   * The pinned dialog rides on a `Marker`, so the map moves it.
   *
   * Positioning it from React would mean re-projecting on every frame of a pan; a
   * marker is the platform's answer to exactly that, and portalling into its element
   * keeps the dialog itself ordinary React.
   */
  useEffect(() => {
    if (!ready || !map.current || !pinAt) return

    const element = document.createElement('div')
    const marker = new maplibregl.Marker({ element, anchor: 'bottom', offset: [0, -14] })
      .setLngLat([pinAt.lon, pinAt.lat])
      .addTo(map.current)
    setPinHost(element)

    return () => {
      marker.remove()
      setPinHost(null)
    }
  }, [ready, pinAt])

  // A bookmarked URL arrives with a bbox and a camera that has never seen it. Restore
  // it, and adopt the key it corresponds to, so the fit above does not immediately
  // throw the bookmarked view away in favour of everything.
  const restored = useRef(false)
  useEffect(() => {
    if (!ready || !map.current || restored.current) return
    restored.current = true
    if (filter.bbox === null) return

    const [west, south, east, north] = filter.bbox
    fitted.current = fitKey
    map.current.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { duration: 0 },
    )
  }, [ready, filter.bbox, fitKey])

  return (
    <>
      <div ref={container} className={styles.map} data-testid="map" />
      {pinHost && pin ? createPortal(pin, pinHost) : null}
    </>
  )
}

export { FOCUS_LAYER }
