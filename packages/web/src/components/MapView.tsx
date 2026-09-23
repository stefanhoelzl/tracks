import type { ActivityDetail, Filter, TrackCollection } from '@tracks/core'
import { formatFilter } from '@tracks/core'
import type { LatLon, Leg } from '@tracks/routing'
import type {
  GeoJSONSource,
  LngLatBoundsLike,
  MapLayerMouseEvent,
  MapLayerTouchEvent,
  MapLibreMap,
  MapTouchEvent,
} from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import { cumulativeDistances } from '../lib/geo.ts'
import { sliceBetween } from '../lib/profile.ts'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  type DragEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { activityColour, type ColourScale, emphasise } from '../lib/colour.ts'
import { nearestIndex } from '../lib/geo.ts'
import type { Plan } from '../lib/plan.ts'
import { addWaypoint, insertionAt } from '../lib/plan-ops.ts'
import type { Reference } from '../lib/references.ts'
import { type Basemap, basemapStyle } from '../map/basemap.ts'
import { ClusterMarkers } from '../map/clusters.ts'
import {
  addTrackLayers,
  CURSOR_SOURCE,
  FOCUS_LAYER,
  HELD_BACK,
  paint,
  paintTracks,
  RANGE_SOURCE,
  SELECTED_CASING_LAYER,
  SELECTED_LAYER,
  SELECTED_SOURCE,
  STARTS_SOURCE,
  startPoints,
  TRACKS_LAYER,
  TRACKS_SOURCE,
} from '../map/layers.ts'
import {
  addPlanLayers,
  beelineFeatures,
  PENDING_OPACITY,
  ACCENT as PLAN_ACCENT,
  PLAN_CASING_LAYER,
  PLAN_FAILED_LAYER,
  PLAN_LINE_LAYER,
  PLAN_PENDING_LAYER,
  PLAN_POI_LAYER,
  PLAN_POINTS_SOURCE,
  PLAN_PREVIEW_SOURCE,
  PLAN_SHAPING_LAYER,
  PLAN_SOURCE,
  previewFeature,
  routeFeatures,
  showPlan,
  waypointFeatures,
} from '../map/plan-layers.ts'
import {
  addReferenceLayers,
  REFERENCE_POINTS_SOURCE,
  REFERENCE_SOURCE,
  REFERENCE_WPT_LAYER,
  referenceFeatures,
  referencePointFeatures,
  showReferences,
} from '../map/reference-layers.ts'
import { geographicBbox } from '../map/viewport.ts'
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

/** A drag carrying files, rather than text or a dragged element from the page. */
function hasFiles(event: DragEvent<HTMLElement>): boolean {
  return [...event.dataTransfer.types].includes('Files')
}

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
  /** Go and look at a place — what picking a search result means. */
  flyTo: (at: LatLon) => void
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
  /** Where it was last seen: a finger's `touchend` carries no position of its own. */
  last?: LatLon
}

/** The camera's padding for every fit: the visible map, and a margin inside it. */
function paddingOf(insets: { left: number; right: number; top?: number; bottom?: number }) {
  return {
    top: (insets.top ?? DESKTOP_TOP) + 24,
    bottom: (insets.bottom ?? 0) + 40,
    left: insets.left + 32,
    right: insets.right + 32,
  }
}

/** How close the pinned dialog may come to an edge of the visible map. */
const PIN_EDGE_PX = 8
/** How far above its pin the dialog sits: clear of the pin's head. */
const PIN_OFFSET_PX = 14

/** Where the desktop's top bar ends: its gap, its height. */
const DESKTOP_TOP = 16 + 56

/** How long a finger has to rest on a stop or the line before it picks it up. */
const LONG_PRESS_MS = 450
/** How far it may wander meanwhile. Any further and it was a pan, which the map is doing. */
const PRESS_SLOP_PX = 8
/** How long after a drag the click it ends in is swallowed, rather than read as a new waypoint. */
const SUPPRESS_CLICK_MS = 500

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
  references,
  cursorTrack,
  range,
  pending,
  preview,
  pin,
  pinAt,
  onHover,
  onCursor,
  onSelect,
  onViewportChange,
  onMapClick,
  onLongPress,
  onWaypointClick,
  onWaypointMove,
  onShapingDrop,
  onReferenceWaypoint,
  onDropFiles,
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
  /**
   * How much of the map is under glass on each side, so a fit centres in what can be seen.
   * `top` is where the top bar ends and `bottom` how tall the phone's sheet stands; left
   * out, they are the desktop's bar and nothing.
   */
  panelInsets: { left: number; right: number; top?: number; bottom?: number }
  /** While this is on the tracks are dim and inert, and every click means *waypoint*. */
  planning: boolean
  plan: Plan
  /** One slot per leg; `undefined` while that leg is still in flight. */
  legs: Array<Leg | undefined>
  /** Every routed leg end to end — what the elevation cursor indexes into. */
  plannedTrack: Array<[number, number]>
  /** Dropped files, drawn above the dimmed rides and below the plan. */
  references: readonly Reference[]
  /**
   * What the elevation cursor indexes into, when it is not the plan.
   *
   * An open reference's profile shares the one cursor with everything else — it is one
   * index, resolved from whichever end moved — but an index means nothing without the
   * array it indexes. So the array comes with it rather than being assumed.
   */
  cursorTrack: Array<[number, number]> | null
  /**
   * The stretch two bars on the elevation profile enclose, in metres along whichever track the
   * cursor belongs to. The map draws that piece over the line and holds the rest back.
   */
  range: { fromM: number; toM: number; totalM: number } | null
  /** A leg is outstanding, which is what the dashed line pulses to say. */
  pending: boolean
  /** The search result under the pointer, drawn as a ring. Not part of the plan. */
  preview: LatLon | null
  /** The pinned dialog, positioned at `pinAt` and moved by the map, not by the page. */
  pin: ReactNode
  pinAt: LatLon | null
  onHover: (id: number | null) => void
  onCursor: (index: number | null) => void
  onSelect: (id: number | null) => void
  onViewportChange: (bbox: [number, number, number, number]) => void
  /**
   * A click anywhere on the map. Which leg it meant is decided by distance, above this
   * — a hit test would make shaping a route a game of aiming at a few pixels.
   */
  onMapClick: (at: LatLon) => void
  /** A finger held still on the map, off any stop: a shaping point, where the phone app drops one. */
  onLongPress: (at: LatLon) => void
  onWaypointClick: (index: number) => void
  onWaypointMove: (index: number, at: LatLon) => void
  /** A drag off the line: insert a shaping point at `index`, where it was let go. */
  onShapingDrop: (index: number, at: LatLon) => void
  /**
   * A click on a file's `<wpt>`: the same dialog a map click raises, with the name the
   * file gave it already filled in. The only thing a reference does besides be drawn.
   */
  onReferenceWaypoint: (at: LatLon, name: string | null) => void
  /** Files dropped on the map. Planning only; every other mode ignores them. */
  onDropFiles: (files: File[]) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const clusters = useRef<ClusterMarkers | null>(null)
  const [ready, setReady] = useState(false)
  const drag = useRef<Drag | null>(null)
  /**
   * A drag ends in a click MapLibre will still deliver; this is how it is ignored. A time
   * rather than a flag, because a finger's gesture may end in no click at all, and a flag
   * left standing would swallow the next real one.
   */
  const suppressClick = useRef(0)
  /**
   * Where the pinned dialog is drawn, as a box this component positions by hand.
   *
   * Deliberately **not** a `Marker`. A marker lives inside the map's canvas container,
   * so every click in the dialog bubbled to the map and was read as "put a waypoint
   * here" — and the obvious repair does not work either, because React delegates its
   * listeners above the map and stopping the click at the marker takes the dialog's own
   * buttons with it. Rendering the dialog as a *sibling* of the map container ends the
   * whole class of problem: there is no path from the dialog to the map's listeners at
   * all, so nothing about MapLibre's event handling has to be reasoned about.
   *
   * The price is doing what a marker does — reprojecting on every `move` — which is one
   * `project()` and one transform per frame, written straight to the node so React is
   * not re-rendering a dialog sixty times a second.
   */
  const pinBox = useRef<HTMLDivElement>(null)

  /**
   * Whether a file is being dragged over the map.
   *
   * Counted rather than set, because `dragleave` fires for every child the pointer
   * crosses on its way in — a boolean flickers the overlay off under the cursor.
   */
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)

  const insets = useRef(panelInsets)
  insets.current = panelInsets

  useImperativeHandle(ref, () => ({
    zoomBy: (delta: number) =>
      map.current?.zoomTo(map.current.getZoom() + delta, { duration: 250 }),
    // Padded past the panels, so a track at the edge does not land under glass. The
    // move writes the viewport back as the new bbox, like any other.
    centre: () => {
      const at = map.current?.getCenter()
      return at ? { lat: at.lat, lon: at.lng } : null
    },
    // Zooms in to a place worth looking at, and never back out: arriving from a
    // valley-level view only to be pulled out to z13 would lose what you were reading.
    // Brisk, because this also runs while a pointer moves down a list of results.
    flyTo: (at: LatLon) =>
      map.current?.flyTo({
        center: [at.lon, at.lat],
        zoom: Math.max(map.current.getZoom(), 13),
        // Into the part of the map that can be seen, not the middle of the window, which on
        // a phone is behind the sheet.
        padding: paddingOf(insets.current),
        duration: 450,
      }),
    fitBounds: ([west, south, east, north]: [number, number, number, number]) =>
      map.current?.fitBounds(
        [
          [west, south],
          [east, north],
        ],
        {
          padding: paddingOf(insets.current),
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
    onLongPress,
    onWaypointClick,
    onWaypointMove,
    onShapingDrop,
    onReferenceWaypoint,
    onDropFiles,
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
    onLongPress,
    onWaypointClick,
    onWaypointMove,
    onShapingDrop,
    onReferenceWaypoint,
    onDropFiles,
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
          addReferenceLayers(instance)
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

    const at = (event: MapLayerMouseEvent | MapTouchEvent): LatLon => ({
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

    // The one clickable thing on a reference says so. The lines do not, because they
    // are not: a click on one means "put a waypoint here", like everywhere else.
    instance.on('mouseenter', REFERENCE_WPT_LAYER, () => {
      if (live.current.planning && !drag.current) instance.getCanvas().style.cursor = 'pointer'
    })
    instance.on('mouseleave', REFERENCE_WPT_LAYER, () => {
      if (!drag.current) instance.getCanvas().style.cursor = ''
    })

    /**
     * Dragging the line pulls a shaping point out of it.
     *
     * The direct-manipulation form of the rule that a ROUTING point always inserts into
     * the nearest leg — here the leg is not the nearest one, it is the one under the
     * pointer. Its position in the array is settled at `mousedown` and never moves
     * again, so the leg it belongs to cannot change halfway through the gesture.
     */
    const grabLine = (event: MapLayerMouseEvent) => {
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
    }

    // Both lines, because a leg that has not routed yet is still a leg you want to
    // shape — and while the router is slow or unreachable it is the only line there is.
    instance.on('mousedown', PLAN_LINE_LAYER, grabLine)
    instance.on('mousedown', PLAN_FAILED_LAYER, grabLine)
    instance.on('mousedown', PLAN_PENDING_LAYER, grabLine)

    /** The waypoint being dragged follows the pointer, on beelines. */
    const follow = (state: Drag, point: LatLon) => {
      state.moved = true
      state.last = point
      const waypoints = state.waypoints.map((waypoint, index) =>
        index === state.index ? { ...waypoint, lat: point.lat, lon: point.lon } : waypoint,
      )
      // Straight lines to the cursor while the gesture lasts: instant, free, and
      // honest about being provisional. The real request goes on release, which is
      // what keeps one drag to one request rather than forty.
      instance.getSource<GeoJSONSource>(PLAN_SOURCE)?.setData(beelineFeatures(waypoints))
      instance.getSource<GeoJSONSource>(PLAN_POINTS_SOURCE)?.setData(waypointFeatures(waypoints))
    }

    /** Where the gesture ended becomes the plan, and the click it ends in is not a waypoint. */
    const commit = (state: Drag, point: LatLon | undefined) => {
      endDrag()
      if (!state.moved || !point) return
      suppressClick.current = performance.now() + SUPPRESS_CLICK_MS
      if (state.kind === 'waypoint') live.current.onWaypointMove(state.index, point)
      else live.current.onShapingDrop(state.index, point)
    }

    instance.on('mousemove', (event: MapLayerMouseEvent) => {
      const state = drag.current
      if (state) follow(state, at(event))
    })

    instance.on('mouseup', (event: MapLayerMouseEvent) => {
      const state = drag.current
      if (state) commit(state, at(event))
    })

    /**
     * A finger's gestures: the phone app's, behind a long press.
     *
     * A finger that lands on a stop is far more often starting a pan or a pinch than
     * picking the stop up, so nothing happens until it has rested there for a moment — the
     * rule the phone app's editor follows, and for the same reason. Wandering off first
     * makes it a pan, which the map is already doing. Held on a stop, it picks the stop up,
     * the map stops panning and the gesture is the mouse's: follow, then commit on release.
     * Held anywhere else, it drops a shaping point there, as the app does.
     */
    const press: {
      timer?: ReturnType<typeof setTimeout>
      x: number
      y: number
      arm?: () => Drag | null
    } = { x: 0, y: 0 }
    const cancelPress = () => {
      clearTimeout(press.timer)
      press.timer = undefined
      press.arm = undefined
    }

    const pressOn = (event: MapTouchEvent, arm: () => Drag | null) => {
      // First come, first served: a stop sits on the line, and the stop is what was meant.
      if (!live.current.planning || drag.current || press.arm) return
      if (event.points.length !== 1) return
      press.x = event.point.x
      press.y = event.point.y
      press.arm = arm
      press.timer = setTimeout(() => {
        const pick = press.arm
        cancelPress()
        if (!pick) return
        const state = pick()
        navigator.vibrate?.(10)
        // The lift that ends a press is not also a tap on the map.
        suppressClick.current = performance.now() + LONG_PRESS_MS + SUPPRESS_CLICK_MS
        if (state) beginDrag(state)
      }, LONG_PRESS_MS)
    }

    const pressWaypoint = (event: MapLayerTouchEvent) => {
      const index = event.features?.[0]?.properties?.index
      if (typeof index !== 'number') return
      pressOn(event, () => ({
        kind: 'waypoint',
        index,
        waypoints: live.current.plan.waypoints,
        moved: false,
      }))
    }
    instance.on('touchstart', PLAN_POI_LAYER, pressWaypoint)
    instance.on('touchstart', PLAN_SHAPING_LAYER, pressWaypoint)

    /**
     * Anywhere else, a long press drops a shaping point into the nearest leg, where the finger is — the phone app's
     * gesture, where a mouse drags one out of the line. No line to aim at: a finger is wider than the line, and
     * "bend the route here" does not need one. Registered after the stops, so a press on a stop is the stop's.
     */
    instance.on('touchstart', (event: MapTouchEvent) => {
      const point = at(event)
      pressOn(event, () => {
        live.current.onLongPress(point)
        return null
      })
    })

    instance.on('touchmove', (event: MapTouchEvent) => {
      if (press.arm) {
        const dx = event.point.x - press.x
        const dy = event.point.y - press.y
        if (dx * dx + dy * dy > PRESS_SLOP_PX * PRESS_SLOP_PX || event.points.length !== 1) {
          cancelPress()
        }
        return
      }
      const state = drag.current
      if (!state) return
      // Or the page scrolls, and the browser turns the lift into a click.
      event.preventDefault()
      follow(state, at(event))
    })

    const release = () => {
      cancelPress()
      const state = drag.current
      if (!state) return
      // Held and let go without moving is still a gesture: the tap it ends in is not a waypoint.
      suppressClick.current = performance.now() + SUPPRESS_CLICK_MS
      commit(state, state.last)
    }
    instance.on('touchend', release)
    instance.on('touchcancel', release)

    /**
     * One click handler rather than one per layer.
     *
     * An existing waypoint is the only thing worth hit-testing for, because clicking one
     * means *that* one and nothing else. Everything else is a click on the map, and
     * which leg it meant is a question of distance answered above this component.
     */
    instance.on('click', (event: MapLayerMouseEvent) => {
      if (!live.current.planning) return
      if (performance.now() < suppressClick.current) {
        suppressClick.current = 0
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

      /**
       * A file's own mark, which is the one thing on a reference that is clickable.
       *
       * Its *own* coordinates, taken from the feature rather than from the click, so
       * adopting a hut puts the stop where the file put it rather than where the
       * pointer landed. Checked after the plan's waypoints: yours wins a tie.
       */
      const onReference = instance.queryRenderedFeatures(event.point, {
        layers: present([REFERENCE_WPT_LAYER]),
      })
      const mark = onReference[0]?.properties
      if (mark && typeof mark.lat === 'number' && typeof mark.lon === 'number') {
        const name = typeof mark.name === 'string' && mark.name !== '' ? mark.name : null
        live.current.onReferenceWaypoint({ lat: mark.lat, lon: mark.lon }, name)
        return
      }

      live.current.onMapClick(at(event))
    })

    instance.on('render', () => {
      if (live.current.grouped) clusters.current?.refresh()
    })

    let moveTimer: ReturnType<typeof setTimeout> | undefined
    instance.on('moveend', () => {
      clearTimeout(moveTimer)
      moveTimer = setTimeout(() => {
        // What the camera reports is not yet a place on the earth: `geographicBbox` is
        // the step that makes it one, and the filter only accepts the latter.
        const [[west, south], [east, north]] = instance.getBounds().toArray()
        live.current.onViewportChange(geographicBbox([west!, south!, east!, north!]))
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

  useEffect(() => {
    if (!ready || !map.current) return
    map.current.getSource<GeoJSONSource>(PLAN_PREVIEW_SOURCE)?.setData(previewFeature(preview))
  }, [ready, preview])

  // --- Dropped files --------------------------------------------------------

  useEffect(() => {
    if (!ready || !map.current) return
    showReferences(map.current, planning)
  }, [ready, planning])

  useEffect(() => {
    if (!ready || !map.current) return
    map.current.getSource<GeoJSONSource>(REFERENCE_SOURCE)?.setData(referenceFeatures(references))
    map.current
      .getSource<GeoJSONSource>(REFERENCE_POINTS_SOURCE)
      ?.setData(referencePointFeatures(references))
  }, [ready, references])

  /**
   * The dashed line breathes while the router is still thinking.
   *
   * The one animation in this app, for the one thing in it that is waiting on somebody
   * else — a spinner would have to go somewhere, and the thing being waited for is
   * already on screen and already the right shape. Only the pending layer pulses: a leg
   * that *cannot* be routed must not, because a failure that looks like it is loading is
   * a failure nobody stops waiting for.
   */
  useEffect(() => {
    const instance = map.current
    if (!ready || !instance?.getLayer(PLAN_PENDING_LAYER)) return

    if (!planning || !pending) {
      instance.setPaintProperty(PLAN_PENDING_LAYER, 'line-opacity', PENDING_OPACITY.rest)
      return
    }

    let frame = 0
    const started = performance.now()
    const pulse = (now: number) => {
      const phase = ((now - started) % PENDING_OPACITY.periodMs) / PENDING_OPACITY.periodMs
      const swing = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI)
      instance.setPaintProperty(
        PLAN_PENDING_LAYER,
        'line-opacity',
        PENDING_OPACITY.low + (PENDING_OPACITY.rest - PENDING_OPACITY.low) * swing,
      )
      frame = requestAnimationFrame(pulse)
    }
    frame = requestAnimationFrame(pulse)

    return () => cancelAnimationFrame(frame)
  }, [ready, planning, pending])

  // Not while a drag owns these sources: it is painting a preview into them, and this
  // would overwrite it with the route the preview is replacing.
  useEffect(() => {
    if (!ready || !map.current || drag.current) return
    map.current.getSource<GeoJSONSource>(PLAN_SOURCE)?.setData(routeFeatures(plan.waypoints, legs))
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
          addReferenceLayers(instance)
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

    // Whichever track the cursor belongs to: an open reference first, then the plan
    // while planning, then the selected activity — one mechanism, three sources.
    const coordinates = cursorTrack ?? (planning ? plannedTrack : detail?.track.coordinates)
    const point = cursor === null ? undefined : coordinates?.[cursor]
    source.setData({
      type: 'FeatureCollection',
      features: point
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } }]
        : [],
    })
  }, [ready, cursor, detail, planning, plannedTrack, cursorTrack])

  /**
   * What a selected stretch is drawn in: the plan's accent while planning, and otherwise the
   * selected activity's own colour turned up — the very value the line under it is painted with.
   */
  const rangeColour = useMemo(() => {
    if (planning || cursorTrack) return PLAN_ACCENT
    if (!detail) return PLAN_ACCENT
    return emphasise(
      activityColour(
        detail.activity.tags,
        Number(detail.activity.localDate.slice(0, 4)),
        colourBy,
        scale,
      ),
    )
  }, [planning, cursorTrack, detail, colourBy, scale])

  // The stretch the two bars enclose, on the same track the cursor indexes into.
  useEffect(() => {
    if (!ready || !map.current) return
    const source = map.current.getSource<GeoJSONSource>(RANGE_SOURCE)
    if (!source) return

    const coordinates = cursorTrack ?? (planning ? plannedTrack : detail?.track.coordinates)
    // Measured here rather than handed over: the profile scales its distances to the reported
    // length, and `cumulativeDistances` is the same scaling, so the two agree by construction.
    const along = range && coordinates ? cumulativeDistances(coordinates, range.totalM) : null
    const slice =
      range && coordinates && along ? sliceBetween(coordinates, along, range.fromM, range.toM) : []
    source.setData({
      type: 'FeatureCollection',
      features:
        slice.length > 1
          ? [
              {
                type: 'Feature',
                // The same key the selected line is painted from, so the stretch keeps that line's
                // own colour rather than taking one of its own.
                properties: { colourHi: rangeColour },
                geometry: { type: 'LineString', coordinates: slice },
              },
            ]
          : [],
    })
    // The line under it is held back while a piece of it is being talked about.
    for (const layer of [SELECTED_LAYER, SELECTED_CASING_LAYER]) {
      if (map.current.getLayer(layer)) {
        map.current.setPaintProperty(
          layer,
          'line-opacity',
          slice.length > 1 ? HELD_BACK : undefined,
        )
      }
    }
  }, [ready, range, detail, planning, plannedTrack, cursorTrack, rangeColour])

  // --- Camera ---------------------------------------------------------------

  /**
   * What the camera is currently framing, as a cause rather than as a result.
   *
   * The bbox is deliberately not in it. Every fit ends in a `moveend` that writes the
   * viewport back as the new bbox, so keying on the whole filter would make each fit
   * the reason for the next one. Keyed on what the user *did* — changed a filter,
   * opened an activity, which is the same thing — a fit's own write cannot retrigger
   * it, and the loop that cost the auto-fit in the first place cannot form.
   */
  const fitKey = formatFilter({ ...filter, bbox: null }).toString()
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

    // Everything that matches, which `extent` gives with the viewport term dropped — the
    // tracks payload cannot, since the viewport is exactly what removed the rest of it.
    // An open activity is a term in the filter, so this is its own box: the same target
    // *fit everything* flies to, from the same number.
    const target = extent && boundsOfCoordinates([extent.slice(0, 2), extent.slice(2, 4)])

    // Not yet: the facets for this filter are still in flight. Leaving `fitted` alone
    // means this runs again when they land, rather than never.
    if (!target) return

    fitted.current = fitKey
    map.current.fitBounds(target, {
      padding: paddingOf(insets.current),
      duration: 700,
      maxZoom: 14,
    })
  }, [ready, fitKey, extent, planning])

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
      padding: paddingOf(insets.current),
      duration: 0,
      maxZoom: 14,
    })
  }, [ready, planning])

  /** Keeps the dialog over its place while the camera moves — see `pinBox`. */
  useEffect(() => {
    const instance = map.current
    if (!ready || !instance || !pinAt) return

    /**
     * Over the place, and on the screen. The dialog is centred above its pin, slid sideways
     * when that would put it past an edge — its tail stays on the pin — and hung below the
     * pin instead when the top bar leaves no room above. On a phone both happen often.
     */
    const place = () => {
      const box = pinBox.current
      if (!box) return
      const at = instance.project([pinAt.lon, pinAt.lat])
      box.style.transform = `translate(${at.x}px, ${at.y}px)`

      const dialog = box.firstElementChild as HTMLElement | null
      if (!dialog) return
      const width = instance.getContainer().clientWidth
      const w = dialog.offsetWidth
      const h = dialog.offsetHeight
      const left = at.x - w / 2
      const shift =
        left < PIN_EDGE_PX
          ? PIN_EDGE_PX - left
          : left + w > width - PIN_EDGE_PX
            ? width - PIN_EDGE_PX - (left + w)
            : 0
      const below = at.y - PIN_OFFSET_PX - h < (insets.current.top ?? DESKTOP_TOP) + PIN_EDGE_PX
      dialog.style.translate = `calc(-50% + ${shift}px) ${below ? `${PIN_OFFSET_PX}px` : `calc(-100% - ${PIN_OFFSET_PX}px)`}`
      dialog.style.setProperty('--tail-shift', `${-shift}px`)
      dialog.toggleAttribute('data-below', below)
    }

    place()

    /**
     * A pin opened where it cannot be seen — a stop picked from the list that is under the
     * sheet, or off the side — brings the map to it, by as little as puts it in view.
     */
    const at = instance.project([pinAt.lon, pinAt.lat])
    const box = instance.getContainer()
    const { left, right, top, bottom } = insets.current
    const minX = left + PIN_EDGE_PX
    const maxX = box.clientWidth - right - PIN_EDGE_PX
    const minY = (top ?? DESKTOP_TOP) + PIN_EDGE_PX
    const maxY = box.clientHeight - (bottom ?? 0) - PIN_EDGE_PX * 3
    const dx = at.x < minX ? at.x - minX : at.x > maxX ? at.x - maxX : 0
    const dy = at.y < minY ? at.y - minY : at.y > maxY ? at.y - maxY : 0
    // Not while the camera is already flying there, which is what a search result does.
    if ((dx !== 0 || dy !== 0) && maxX > minX && maxY > minY && !instance.isMoving()) {
      instance.panBy([dx, dy], { duration: 300 })
    }

    instance.on('move', place)
    return () => {
      instance.off('move', place)
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

  /**
   * Files land on the map itself, which is the only surface that makes sense for them:
   * a reference is a thing on the map, and planning is the only mode that has any.
   */
  const fileDrag = planning
    ? {
        onDragEnter: (event: DragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return
          dragDepth.current += 1
          setDropping(true)
        },
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return
          // Without this the browser navigates to the file instead of handing it over.
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        },
        onDragLeave: () => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (dragDepth.current === 0) setDropping(false)
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          dragDepth.current = 0
          setDropping(false)
          const files = [...event.dataTransfer.files]
          if (files.length > 0) onDropFiles(files)
        },
      }
    : {}

  return (
    <>
      <div ref={container} className={styles.map} data-testid="map" {...fileDrag} />
      {dropping ? (
        <div className={styles.dropZone} data-testid="drop-zone">
          <div className={styles.dropCard}>
            <strong>Drop to add a reference</strong>
            <span>GPX or TCX — drawn over your rides, never sent anywhere</span>
          </div>
        </div>
      ) : null}
      {/* A sibling of the map, never a child of it: that is the whole fix for a click
          in the dialog also landing on the map behind it. */}
      {pin && pinAt ? (
        <div ref={pinBox} className={styles.pinAnchor}>
          <div className={styles.pinDialog}>{pin}</div>
        </div>
      ) : null}
    </>
  )
}

export { FOCUS_LAYER }
