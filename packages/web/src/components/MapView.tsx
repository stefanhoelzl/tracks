import type { ActivityDetail, Filter, TrackCollection } from '@tracks/core'
import type { GeoJSONSource, LngLatBoundsLike, MapLayerMouseEvent, MapLibreMap } from 'maplibre-gl'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ColourScale } from '../lib/colour.ts'
import { basemapStyle } from '../map/basemap.ts'
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

/** Long enough that a slider drag fits once, short enough to feel immediate. */
const SETTLE_MS = 300

/** The map is the filter while this is on, so it must not chase itself. */
const MOVE_MS = 250

const INITIAL = { center: [11.0, 47.5] as [number, number], zoom: 5 }

function boundsOf(tracks: TrackCollection): LngLatBoundsLike | null {
  const bounds = new maplibregl.LngLatBounds()
  for (const feature of tracks.features) {
    for (const coordinate of feature.geometry.coordinates) bounds.extend(coordinate)
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
  filter,
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
  filter: Filter
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
    basemapStyle()
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
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: detail.track.coordinates,
          },
        },
      ],
    })
  }, [ready, detail])

  // --- Camera ---------------------------------------------------------------

  const fitted = useRef<string>('')

  useEffect(() => {
    if (!ready || !map.current || !tracks) return

    // The camera writes the filter, so refitting to what the filter then selected would
    // be the map arguing with itself. One fit is allowed — the one before any viewport
    // has been recorded — which is how the opening view frames everything you have.
    if (filter.bbox !== null) return

    const bounds = boundsOf(tracks)
    // Nothing matches: hold the camera rather than lurching at empty bounds.
    if (!bounds) return

    // The same result set must not refit on every unrelated re-render.
    const signature = JSON.stringify([tracks.features.map((f) => f.properties.id), selectedId])
    if (signature === fitted.current) return

    const timer = setTimeout(() => {
      fitted.current = signature
      const target =
        selectedId !== null && detail
          ? boundsOf({
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  id: selectedId,
                  geometry: {
                    type: 'LineString',
                    coordinates: detail.track.coordinates,
                  },
                  properties: { id: selectedId, tags: [], year: 0 },
                },
              ],
            })
          : bounds

      map.current?.fitBounds(target ?? bounds, {
        padding: {
          top: 88 + 24,
          bottom: 40,
          left: panelInsets.left + 32,
          right: panelInsets.right + 32,
        },
        duration: 700,
        maxZoom: 14,
      })
    }, SETTLE_MS)

    return () => clearTimeout(timer)
  }, [ready, tracks, selectedId, detail, filter.bbox, panelInsets.left, panelInsets.right])

  // A bookmarked URL arrives with a bbox and a camera that has never seen it, and the
  // auto-fit above is disabled precisely because a bbox is set — so without this the view
  // would show one area while filtering to another. Once only: every later bbox comes
  // from the camera, which is already there.
  const restored = useRef(false)
  useEffect(() => {
    if (!ready || !map.current || restored.current) return
    restored.current = true
    if (filter.bbox === null) return
    const [west, south, east, north] = filter.bbox
    map.current.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { duration: 0 },
    )
  }, [ready, filter.bbox])

  // Only reachable before the first viewport is recorded; nothing in the UI clears a
  // bbox once set, because widening the view is a camera move, not a filter to undo.
  useEffect(() => {
    if (filter.bbox === null) fitted.current = ''
  }, [filter.bbox])

  return <div ref={container} className={styles.map} data-testid="map" />
}

export { FOCUS_LAYER }
