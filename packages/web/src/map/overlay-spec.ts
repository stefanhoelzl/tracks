import type { LayerSpecification, MapLibreMap, SourceSpecification } from 'maplibre-gl'

/**
 * Everything drawn over the basemap, on the web and on the phone, as one list of style-spec sources
 * and layers.
 *
 * Each side only feeds GeoJSON into these sources by id, and changes a paint property only where a
 * value is live — a pulse, a line held back while a stretch of it is picked out. What a layer looks
 * like is decided here, once: the phone reads the same list from `overlays.json`, which
 * `pnpm style:app` writes beside `colorful.json`, and `app-style.test.ts` fails when the two drift.
 * Before this, `TracksMap.kt` carried a hand copy of every width and dash, with comments naming the
 * file it was copied from.
 *
 * Two rules on top of the style spec, both in `metadata`, so the layers stay valid style layers:
 *
 * - `platforms` — who draws a layer or a source; untagged means both. The contours need the web's
 *   `maplibre-contour` protocol, and the ridden line and the facing cone exist only on the phone.
 *   Each loader drops what is not its own before anything reaches MapLibre, so neither renderer is
 *   handed a layer on a source it cannot create.
 * - `before` — the layer, of the basemap or of this list, a layer goes under. Without one it goes
 *   on top, in list order, so the list order is the stack.
 *
 * A source whose tiles only exist at runtime names a `{placeholder}` the web fills in, and an image
 * only a platform can paint — the phone's facing cone — carries the colour to paint it in as
 * `imageColour`.
 */

export type Platform = 'web' | 'app'

export type OverlayMetadata = {
  readonly platforms?: readonly Platform[]
  readonly before?: string
  /** For a layer whose image the platform paints at runtime: the colour to paint it in. */
  readonly imageColour?: string
}

export type OverlaySource = SourceSpecification & { metadata?: OverlayMetadata }
export type OverlayLayer = LayerSpecification & { metadata?: OverlayMetadata }

export type Overlays = {
  readonly sources: Readonly<Record<string, OverlaySource>>
  readonly layers: readonly OverlayLayer[]
}

export function concat(...parts: Overlays[]): Overlays {
  return {
    sources: Object.assign({}, ...parts.map((part) => part.sources)),
    layers: parts.flatMap((part) => part.layers),
  }
}

const drawnBy = (platform: Platform, metadata?: OverlayMetadata) =>
  !metadata?.platforms || metadata.platforms.includes(platform)

/** What one platform draws, with the sources' metadata taken off: the style spec has no place for it. */
export function overlaysFor(overlays: Overlays, platform: Platform) {
  const sources = Object.fromEntries(
    Object.entries(overlays.sources)
      .filter(([, source]) => drawnBy(platform, source.metadata))
      .map(([id, { metadata: _, ...source }]) => [id, source as SourceSpecification]),
  )
  const layers = overlays.layers.filter((layer) => drawnBy(platform, layer.metadata))
  return { sources, layers }
}

/** The layer's place in the stack: under its `before` where that is drawn, on top otherwise. */
export function beforeOf(
  layer: OverlayLayer,
  present: (id: string) => boolean,
): string | undefined {
  const before = layer.metadata?.before
  return before && present(before) ? before : undefined
}

/** The web's part of `overlays`, added to a loaded map. */
export function addOverlays(map: MapLibreMap, overlays: Overlays): void {
  const { sources, layers } = overlaysFor(overlays, 'web')
  for (const [id, source] of Object.entries(sources)) map.addSource(id, source)
  for (const layer of layers) {
    map.addLayer(
      layer,
      beforeOf(layer, (id) => map.getLayer(id) !== undefined),
    )
  }
}
