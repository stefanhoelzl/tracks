package net.stho.tracks.ui.map

import androidx.compose.ui.graphics.Color
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okio.FileSystem
import okio.Path.Companion.toPath

/** The overlays from the web's `overlays.ts`, against the ids this app feeds and the rules it merges them by. */
class OverlaysTest {
    private fun read(name: String) = FileSystem.SYSTEM.read("src/commonMain/composeResources/files/$name".toPath()) { readUtf8() }

    private val overlays = read("overlays.json")
    private val merged = Json.parseToJsonElement(withOverlays(read("colorful.json"), overlays)).jsonObject
    private val sources = merged.getValue("sources").jsonObject
    private val layers = merged.getValue("layers").jsonArray.map { it.jsonObject }
    private val ids = layers.map { it.getValue("id").jsonPrimitive.content }

    @Test
    fun everySourceAndLayerTheAppFeedsIsThereForIt() {
        // A rename in overlays.ts, not carried here, fails now rather than as a map that quietly draws nothing.
        for (source in OverlayIds.SOURCES) {
            assertEquals("geojson", sources[source]?.jsonObject?.get("type")?.jsonPrimitive?.content, source)
        }
        for (layer in OverlayIds.LAYERS) assertTrue(layer in ids, layer)
    }

    @Test
    fun theFacingConeIsDrawnWithTheImageTheAppPaints() {
        val facing = layers.first { it["id"]?.jsonPrimitive?.content == OverlayIds.RIDER_FACING_LAYER }
        assertEquals(OverlayIds.RIDER_FACING_IMAGE, facing.getValue("layout").jsonObject.getValue("icon-image").jsonPrimitive.content)
        assertNotNull(imageColour(overlays, OverlayIds.RIDER_FACING_LAYER))
    }

    @Test
    fun leavesOutWhatOnlyTheWebDraws() {
        for (web in listOf("contour-lines", "tracks-base", "reference-line", "plan-preview-ring")) assertFalse(web in ids, web)
        for (web in listOf("contours", "tracks", "starts", "reference", "plan-preview")) assertFalse(web in sources, web)
    }

    @Test
    fun drawsTheOverlaysOverTheBasemapInTheirOwnOrder() {
        val basemap = Json.parseToJsonElement(read("colorful.json")).jsonObject.getValue("layers").jsonArray
        assertEquals(basemap.map { it.jsonObject.getValue("id").jsonPrimitive.content }, ids.take(basemap.size))
        assertTrue(ids.indexOf("plan-casing") < ids.indexOf("plan-line"))
        assertTrue(ids.indexOf("plan-line") < ids.indexOf(OverlayIds.RIDDEN_LAYER))
        assertTrue(ids.indexOf("range-line") < ids.indexOf("cursor-dot"))
    }

    @Test
    fun givesMapLibreNoSourceMetadata() {
        for ((id, source) in sources) assertNull(source.jsonObject["metadata"], id)
    }

    @Test
    fun putsALayerUnderItsBeforeAndOnTopWithoutOne() {
        val style = """{"version":8,"sources":{},"layers":[{"id":"a"},{"id":"labels"}]}"""
        val extra = """{"sources":{"s":{"type":"geojson","data":{},"metadata":{"platforms":["app"]}},"w":{"type":"geojson","data":{},"metadata":{"platforms":["web"]}}},
            "layers":[{"id":"under","metadata":{"before":"labels"}},{"id":"top"},{"id":"missing","metadata":{"before":"nowhere"}},{"id":"web","metadata":{"platforms":["web"]}}]}"""
        val result = Json.parseToJsonElement(withOverlays(style, extra)).jsonObject
        assertEquals(
            listOf("a", "under", "labels", "top", "missing"),
            result.getValue("layers").jsonArray.map { it.jsonObject.getValue("id").jsonPrimitive.content },
        )
        assertEquals(setOf("s"), result.getValue("sources").jsonObject.keys)
        assertEquals(JsonObject(emptyMap()), result.getValue("sources").jsonObject.getValue("s").jsonObject["data"])
    }

    @Test
    fun readsTheColoursTheOverlaysWrite() {
        assertEquals(Color(0xFF2F6FD6), hexColour("#2f6fd6"))
    }
}
