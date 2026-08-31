import type { ActivityDetail, Filter, TrackCollection } from '@tracks/core'
import { formatFilter } from '@tracks/core'
import type { GeoJSONSource, LngLatBoundsLike, MapLayerMouseEvent, MapLibreMap } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { activityColour, type ColourScale, emphasise } from '../lib/colour.ts'
import { type Basemap, basemapStyle } from '../map/basemap.ts'
import { ClusterMarkers } from '../map/clusters.ts'
import {
  addTrackLayers,
  FOCUS_LAYER,
  paint,
  paintTracks,
  SELECTED_SOURCE,
  STARTS_SOURCE,
  startPoints,
  TRACKS_LAYER,
  TRACKS_SOURCE,
} from '../map/layers.ts'
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
  panelInsets,
  onHover,
  onSelect,
  onViewportChange,
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
  /** Left and right panel widths, so a fit centres in the visible map, not under glass. */
  panelInsets: { left: number; right: number }
  onHover: (id: number | null) => void
  onSelect: (id: number | null) => void
  onViewportChange: (bbox: [number, number, number, number]) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const clusters = useRef<ClusterMarkers | null>(null)
  const [ready, setReady] = useState(false)

  useImperativeHandle(ref, () => ({
    zoomBy: (delta: number) =>
      map.current?.zoomTo(map.current.getZoom() + delta, { duration: 250 }),
    // Padded past the panels, so a track at the edge does not land under glass. The
    // move writes the viewport back as the new bbox, like any other.
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
  const live = useRef({ grouped, onViewportChange, onSelect, onHover })
  live.current = { grouped, onViewportChange, onSelect, onHover }

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
    basemapStyle(basemap)
      .then((style) => {
        if (cancelled) return
        instance.setStyle(style)
        instance.once('styledata', () => {
          if (cancelled) return
          addTrackLayers(instance)
          clusters.current = new ClusterMarkers(instance)
          setReady(true)
        })
      })
      .catch((error) => console.error('basemap failed to load', error))

    instance.on('mousemove', TRACKS_LAYER, (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id
      instance.getCanvas().style.cursor = 'pointer'
      if (typeof id === 'number') live.current.onHover(id)
    })
    instance.on('mouseleave', TRACKS_LAYER, () => {
      instance.getCanvas().style.cursor = ''
      live.current.onHover(null)
    })
    instance.on('click', TRACKS_LAYER, (event: MapLayerMouseEvent) => {
      const id = event.features?.[0]?.properties?.id
      if (typeof id === 'number') live.current.onSelect(id)
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
    paintTracks(map.current, { focusId: hoveredId ?? selectedId, grouped })
  }, [ready, hoveredId, selectedId, grouped])

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

    if (!detail) {
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
  }, [ready, detail, colourBy, scale])

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
  }, [ready, fitKey, extent, detail, selectedId, panelInsets.left, panelInsets.right])

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

  return <div ref={container} className={styles.map} data-testid="map" />
}

export { FOCUS_LAYER }
