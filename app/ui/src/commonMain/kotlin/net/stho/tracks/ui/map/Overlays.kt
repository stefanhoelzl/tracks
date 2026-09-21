package net.stho.tracks.ui.map

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Everything the map draws over the basemap, from the web's own `overlays.ts`: `pnpm style:app` writes it as
 * `overlays.json` beside `colorful.json`, and it is merged into the style here, as the style is read.
 *
 * So the plan, the ride and the cursor are layers of the style, not composables, and this app only feeds their sources
 * and, where a value is live, sets a paint property: what a layer looks like is decided once, in TypeScript, for both
 * platforms. Two rules ride along in each entry's `metadata`: `platforms` says who draws it — untagged means both,
 * and the web's contours and archive are dropped here — and `before` names the layer it goes under; without one it goes
 * on top, in the file's order.
 */
internal fun withOverlays(style: String, overlays: String): String {
    val base = Json.parseToJsonElement(style).jsonObject
    val drawn = Json.parseToJsonElement(overlays).jsonObject

    val sources = base.getValue("sources").jsonObject.toMutableMap()
    for ((id, source) in drawn.getValue("sources").jsonObject) {
        val definition = source.jsonObject
        // The style spec has no place for a source's metadata; MapLibre is never shown it.
        if (definition.isDrawnHere()) sources[id] = JsonObject(definition - "metadata")
    }

    val layers = base.getValue("layers").jsonArray.toMutableList()
    for (layer in drawn.getValue("layers").jsonArray.map { it.jsonObject }.filter { it.isDrawnHere() }) {
        val before = layer.metadata()?.get("before")?.jsonPrimitive?.contentOrNull
        val at = layers.indexOfFirst { it.jsonObject["id"]?.jsonPrimitive?.contentOrNull == before }
        if (at >= 0) layers.add(at, layer) else layers.add(layer)
    }

    return JsonObject(base + ("sources" to JsonObject(sources)) + ("layers" to JsonArray(layers))).toString()
}

/** The colour a layer's runtime-painted image is to be painted in, from its `metadata.imageColour`. */
internal fun imageColour(overlays: String, layerId: String): String? =
    Json.parseToJsonElement(overlays).jsonObject.getValue("layers").jsonArray
        .map { it.jsonObject }
        .firstOrNull { it["id"]?.jsonPrimitive?.contentOrNull == layerId }
        ?.metadata()?.get("imageColour")?.jsonPrimitive?.contentOrNull

private fun JsonObject.metadata(): JsonObject? = this["metadata"] as? JsonObject

private fun JsonObject.isDrawnHere(): Boolean {
    val platforms = metadata()?.get("platforms") as? JsonArray ?: return true
    return platforms.any { it.jsonPrimitive.content == PLATFORM }
}

private const val PLATFORM = "app"

/**
 * The ids this app feeds or changes, as `overlays.ts` names them. `OverlaysTest` fails when one is not in the committed
 * `overlays.json` for this platform — a rename in TypeScript, caught before a map quietly draws nothing.
 */
internal object OverlayIds {
    const val PLAN_SOURCE = "plan"
    const val PLAN_POINTS_SOURCE = "plan-points"
    const val RANGE_SOURCE = "range"
    const val CURSOR_SOURCE = "cursor"
    const val RIDDEN_SOURCE = "ridden"
    const val RIDER_SOURCE = "rider"

    const val PLAN_LINE_LAYER = "plan-line"
    const val PLAN_PENDING_LAYER = "plan-pending"
    const val RIDDEN_LAYER = "ridden"
    const val RIDER_FACING_LAYER = "rider-facing"

    /** The facing cone's image, which this app paints and registers under this name. */
    const val RIDER_FACING_IMAGE = "rider-facing"

    val SOURCES = listOf(PLAN_SOURCE, PLAN_POINTS_SOURCE, RANGE_SOURCE, CURSOR_SOURCE, RIDDEN_SOURCE, RIDER_SOURCE)
    val LAYERS = listOf(PLAN_LINE_LAYER, PLAN_PENDING_LAYER, RIDDEN_LAYER, RIDER_FACING_LAYER)
}
